import { BrowserContext, Page } from 'playwright';
import {
  AbstractCrawler,
  connectToElectronChromium,
  getElectronCrawlerPage,
  notifyLoginRequired,
  notifyLoginSuccess,
} from '../base/BaseCrawler';
import { activeConfig } from '../../tools/config';
import { connectorOutput } from '../../connectors/output/connector-output';
import { configuredTargets, firstMatch, resolveRedirect } from '../base/connectorHelpers';

export class KuaishouCrawler extends AbstractCrawler {
  public browserContext: BrowserContext | null = null;
  public page: Page | null = null;

  public async start(): Promise<void> {
    console.log('[KS] Starting Kuaishou crawler (Electron CDP mode)...');
    const p = require('playwright');
    this.browserContext = await connectToElectronChromium(p);
    this.page = await getElectronCrawlerPage(this.browserContext, 'kuaishou');




    await this.page.goto('https://www.kuaishou.com?isHome=1', { waitUntil: 'domcontentloaded' });
    const landingText = await this.page.locator('body').innerText({ timeout: 2000 }).catch(() => '');
    if (/"result"\s*:\s*2/.test(landingText)) {
      throw new Error('快手拒绝了当前浏览器指纹（result=2）。请完全退出并重启 UniSearch 后重试。');
    }
    await this.handleLogin();

    if (activeConfig.CRAWLER_TYPE === 'search') {
      await this.search();
    } else if (activeConfig.CRAWLER_TYPE === 'detail') {
      await this.getSpecifiedVideos();
    } else if (activeConfig.CRAWLER_TYPE === 'creator') {
      await this.getCreatorsAndVideos();
    }

    console.log('[KS] Kuaishou crawler finished.');
  }

  private async handleLogin(): Promise<void> {
    console.log('[KS] Checking login state...');
    if (activeConfig.LOGIN_TYPE === 'cookie' && activeConfig.COOKIES) {
      await this.applyCookieHeader(this.browserContext!, activeConfig.COOKIES, '.kuaishou.com');
      await this.page!.reload({ waitUntil: 'domcontentloaded' });
    }
    let isLoggedIn = await this.checkLoginState();
    
    if (!isLoggedIn && activeConfig.LOGIN_TYPE === 'qrcode') {
      console.log('[KS] User is not logged in. Waiting for manual login...');
      try {
        await this.page!.locator('xpath=//p[normalize-space(text())="登录"] | //button[normalize-space(.)="登录"] | //a[normalize-space(.)="登录"]').first().click({ timeout: 3000 });
      } catch {}

      notifyLoginRequired('kuaishou', '快手当前会话未登录，需要在采集浏览器中确认或完成登录');

      const startTime = Date.now();
      while (Date.now() - startTime < 120 * 1000) {
        isLoggedIn = await this.checkLoginState();
        if (isLoggedIn) {
          console.log('[KS] Login successful!');
          notifyLoginSuccess('kuaishou');
          break;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      if (!isLoggedIn) {
        throw new Error('快手登录等待超时。请在内置采集浏览器中完成登录后重新运行任务。');
      }
    }
  }

  private async checkLoginState(): Promise<boolean> {
    try {
      if (this.browserContext) {
        const cookies = await this.browserContext.cookies();
        const hasSession = cookies.some((c) => c.name === 'passToken' && c.value.trim().length > 0);
        if (hasSession) {
          console.log('[KS] Login state confirmed via cookies.');
          return true;
        }
      }
    } catch (err: any) {
      console.error('[KS] Error checking cookies:', err.message);
    }
    return false;
  }

  public async search(): Promise<void> {
    const keywords = activeConfig.KEYWORDS.split(',');
    for (const keyword of keywords) {
      console.log(`[KS] Searching keyword: ${keyword}`);
      try {
        const videos: any[] = [];
        const seenIds = new Set<string>();
        const query = `
          fragment photoFields on PhotoEntity {
            id caption originCaption likeCount realLikeCount viewCount commentCount
            coverUrl coverUrls { url } timestamp
          }
          fragment recoPhotoFields on recoPhotoEntity {
            id caption originCaption likeCount realLikeCount viewCount commentCount
            coverUrl coverUrls { url } timestamp
          }
          query visionSearchPhoto($keyword: String, $pcursor: String, $searchSessionId: String, $page: String) {
            visionSearchPhoto(keyword: $keyword, pcursor: $pcursor, searchSessionId: $searchSessionId, page: $page) {
              result searchSessionId pcursor
              feeds {
                author { id name }
                photo { ...photoFields ...recoPhotoFields }
              }
            }
          }`;
        let pageNumber = Math.max(1, activeConfig.START_PAGE || 1);
        let searchSessionId = '';
        const maxPages = Math.max(1, Math.ceil(activeConfig.CRAWLER_MAX_NOTES_COUNT / 20));
        for (let requestIndex = 0; requestIndex < maxPages && videos.length < activeConfig.CRAWLER_MAX_NOTES_COUNT; requestIndex++) {
          const payload = await this.page!.evaluate(async ({ query, keyword, pcursor, searchSessionId }) => {
            const response = await fetch('/graphql', {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json;charset=UTF-8' },
              body: JSON.stringify({
                operationName: 'visionSearchPhoto',
                variables: { keyword, pcursor, page: 'search', searchSessionId },
                query,
              }),
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
          }, { query, keyword, pcursor: String(pageNumber), searchSessionId });
          const result = payload?.data?.visionSearchPhoto;
          if (!result || result.result !== 1) {
            throw new Error(`快手搜索接口拒绝请求（result=${result?.result ?? 'unknown'}），登录状态可能已失效`);
          }
          const feeds = Array.isArray(result.feeds) ? result.feeds : [];
          console.log(`[KS] GraphQL search page ${pageNumber}: ${feeds.length} feeds`);
          for (const feed of feeds) {
            const photo = feed?.photo;
            const author = feed?.author;
            if (!photo?.id || seenIds.has(photo.id)) continue;
            seenIds.add(photo.id);
            videos.push({
              video_id: photo.id,
              title: photo.caption || photo.originCaption || '',
              desc: photo.caption || photo.originCaption || '',
              video_url: `https://www.kuaishou.com/short-video/${photo.id}`,
              video_cover_url: photo.coverUrl || photo.coverUrls?.[0]?.url || '',
              liked_count: String(photo.realLikeCount || photo.likeCount || '0'),
              viewd_count: String(photo.viewCount || '0'),
              comment_count: String(photo.commentCount || '0'),
              nickname: author?.name || '',
              creator_hash: author?.id || '',
              create_time: photo.timestamp ? Math.floor(Number(photo.timestamp) / 1000) : 0,
            });
          }
          if (!feeds.length) break;
          searchSessionId = result.searchSessionId || searchSessionId;
          pageNumber++;
          await this.humanDelay(this.page!);
        }

        console.log(`[KS] Found ${videos.length} videos. Ingesting...`);
        if (!videos.length) throw new Error(`快手未返回“${keyword}”的搜索结果`);
        let count = 0;
        
        for (const v of videos) {
          if (count >= activeConfig.CRAWLER_MAX_NOTES_COUNT) break;
          if (!v.video_id) continue;

          const videoDetail = {
            video_id: v.video_id,
            video_url: v.video_url,
            nickname: v.nickname,
            creator_hash: v.creator_hash,
            title: v.title,
            desc: v.desc,
            create_time: v.create_time,
            liked_count: v.liked_count,
            viewd_count: v.viewd_count,
            comment_count: v.comment_count,
            video_cover_url: v.video_cover_url,
            source_keyword: keyword,
          };

          await connectorOutput.emitKuaishouVideo(videoDetail);
          if (activeConfig.ENABLE_GET_COMMENTS) await this.getVideoComments(v.video_id);
          count++;
          
          await this.humanDelay(this.page!);
        }
      } catch (err: any) {
        console.error(`[KS] Search error for keyword ${keyword}:`, err.message);
        throw err;
      }
    }
  }

  private async fetchVideoDetail(target: string, sourceKeyword: string): Promise<any | null> {
    const resolved = await resolveRedirect(this.page!, target);
    const videoId = firstMatch(resolved, [/\/short-video\/([^/?#]+)/i, /[?&]photoId=([^&#]+)/i]);
    const url = `https://www.kuaishou.com/short-video/${encodeURIComponent(videoId)}`;
    try {
      if (this.page!.url() !== url) await this.page!.goto(url, { waitUntil: 'domcontentloaded' });
      await this.page!.waitForTimeout(1800);
      const detail = await this.page!.evaluate((expectedId) => {
        const state = (window as any).INIT_STATE;
        const decoded: any = {};
        if (state) {
          for (const [key, value] of Object.entries(state)) {
            decoded[key.split('').map((char) => String.fromCharCode(char.charCodeAt(0) - 1)).join('')] = value;
          }
        }
        const seen = new Set<any>();
        const findPhoto = (value: any): any => {
          if (!value || typeof value !== 'object' || seen.has(value)) return null;
          seen.add(value);
          if ((value.id === expectedId || value.photoId === expectedId) && (value.caption !== undefined || value.author)) return value.photo || value;
          if (value.photo?.id === expectedId) return value.photo;
          for (const child of Object.values(value)) {
            const found = findPhoto(child);
            if (found) return found;
          }
          return null;
        };
        const photo = findPhoto(decoded) || {};
        const author = photo.author || {};
        const meta = (selector: string) => document.querySelector(`meta[property="${selector}"], meta[name="${selector}"]`)?.getAttribute('content') || '';
        return {
          id: photo.id || expectedId,
          title: photo.caption || photo.originCaption || meta('og:title'),
          cover: photo.coverUrl || photo.coverUrls?.[0]?.url || meta('og:image'),
          play: photo.photoUrl || photo.videoResource?.h264?.adaptationSet?.[0]?.representation?.[0]?.url || '',
          likes: photo.realLikeCount || photo.likeCount || 0,
          views: photo.viewCount || photo.playCount || 0,
          comments: photo.commentCount || 0,
          timestamp: photo.timestamp || 0,
          authorId: author.id || photo.userId || '',
          authorName: author.name || photo.userName || '',
        };
      }, videoId);
      const record = {
        video_id: String(detail.id || videoId), video_type: 'video', title: detail.title || '', desc: detail.title || '',
        video_url: url, video_cover_url: detail.cover || '', video_play_url: detail.play || '',
        liked_count: String(detail.likes || 0), viewd_count: String(detail.views || 0), comment_count: String(detail.comments || 0),
        creator_hash: String(detail.authorId || ''), nickname: detail.authorName || '',
        create_time: detail.timestamp ? Math.floor(Number(detail.timestamp) / (Number(detail.timestamp) > 1e12 ? 1000 : 1)) : 0,
        source_keyword: sourceKeyword,
      };
      await connectorOutput.emitKuaishouVideo(record);
      if (activeConfig.ENABLE_GET_COMMENTS) await this.getVideoComments(record.video_id);
      return record;
    } catch (error: any) {
      console.error(`[KS] Failed to collect detail ${target}: ${error.message}`);
      return null;
    }
  }

  private async getVideoComments(videoId: string): Promise<void> {
    try {
      if (!this.page!.url().includes(`/short-video/${videoId}`)) {
        await this.page!.goto(`https://www.kuaishou.com/short-video/${encodeURIComponent(videoId)}`, { waitUntil: 'domcontentloaded' });
      }
      await this.page!.waitForTimeout(1500);
      const comments = await this.page!.evaluate(() => Array.from(document.querySelectorAll('[class*="comment-item"], [data-comment-id]')).map((node, index) => {
        const user = node.querySelector('[class*="user-name"], [class*="author"]');
        const content = node.querySelector('[class*="comment-content"], [class*="content"]');
        return {
          id: node.getAttribute('data-comment-id') || `${Date.now()}-${index}`,
          content: content?.textContent?.trim() || '',
          nickname: user?.textContent?.trim() || '',
          creatorId: user?.getAttribute('href')?.split('/').pop() || '',
          subCount: Number(node.getAttribute('data-reply-count') || 0),
        };
      }).filter((comment) => comment.content));
      for (const comment of comments.slice(0, activeConfig.CRAWLER_MAX_COMMENTS_COUNT_SINGLENOTES)) {
        await connectorOutput.emitKuaishouComment({
          comment_id: comment.id, video_id: videoId, content: comment.content,
          create_time: Math.floor(Date.now() / 1000), creator_hash: comment.creatorId,
          nickname: comment.nickname, sub_comment_count: comment.subCount,
        });
      }
      console.log(`[KS] Stored ${comments.length} visible comments for ${videoId}`);
    } catch (error: any) {
      console.error(`[KS] Failed to collect comments for ${videoId}: ${error.message}`);
    }
  }

  public async getSpecifiedVideos(): Promise<void> {
    for (const target of configuredTargets('kuaishou', 'detail')) await this.fetchVideoDetail(target, '指定作品');
  }

  public async getCreatorsAndVideos(): Promise<void> {
    for (const target of configuredTargets('kuaishou', 'creator')) {
      const resolved = await resolveRedirect(this.page!, target);
      const creatorId = firstMatch(resolved, [/\/profile\/([^/?#]+)/i, /[?&]userId=([^&#]+)/i]);
      await this.page!.goto(`https://www.kuaishou.com/profile/${encodeURIComponent(creatorId)}`, { waitUntil: 'domcontentloaded' });
      await this.page!.waitForTimeout(2200);
      const ids = await this.page!.evaluate(() => Array.from(document.querySelectorAll('a[href*="/short-video/"]'))
        .map((link) => link.getAttribute('href')?.match(/\/short-video\/([^/?#]+)/)?.[1] || '').filter(Boolean));
      const unique = [...new Set(ids)].slice(0, activeConfig.CRAWLER_MAX_NOTES_COUNT);
      console.log(`[KS] Creator ${creatorId}: discovered ${unique.length} works`);
      for (const id of unique) await this.fetchVideoDetail(id, `创作者:${creatorId}`);
    }
  }
}
