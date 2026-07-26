import { BrowserContext, Page } from 'playwright';
import {
  AbstractCrawler,
  connectToElectronChromium,
  getElectronCrawlerPage,
  notifyLoginRequired,
  notifyLoginSuccess,
  notifyManualVerificationRequired,
  notifyManualVerificationSuccess,
} from '../base/BaseCrawler';
import { activeConfig } from '../../tools/config';
import { connectorOutput } from '../../connectors/output/connector-output';
import { configuredTargets, firstMatch, resolveRedirect } from '../base/connectorHelpers';

// Kuaishou reports timestamps in milliseconds, but a few legacy fields still come back in seconds.
const toEpochSeconds = (value: unknown): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.floor(numeric > 1e12 ? numeric / 1000 : numeric);
};

const PHOTO_SELECTION = `
  id caption originCaption likeCount realLikeCount viewCount commentCount
  coverUrl coverUrls { url } timestamp
`;

const KS_SEARCH_QUERY = `
  fragment photoFields on PhotoEntity {${PHOTO_SELECTION}}
  fragment recoPhotoFields on recoPhotoEntity {${PHOTO_SELECTION}}
  query visionSearchPhoto($keyword: String, $pcursor: String, $searchSessionId: String, $page: String) {
    visionSearchPhoto(keyword: $keyword, pcursor: $pcursor, searchSessionId: $searchSessionId, page: $page) {
      result searchSessionId pcursor
      feeds {
        author { id name }
        photo { ...photoFields ...recoPhotoFields }
      }
    }
  }`;

const KS_DETAIL_QUERY = `
  query visionVideoDetail($photoId: String, $page: String, $webPageArea: String) {
    visionVideoDetail(photoId: $photoId, page: $page, webPageArea: $webPageArea) {
      status
      author { id name }
      photo {${PHOTO_SELECTION} photoUrl duration}
    }
  }`;

const KS_COMMENT_QUERY = `
  query commentListQuery($photoId: String, $pcursor: String) {
    visionCommentList(photoId: $photoId, pcursor: $pcursor) {
      pcursor commentCount
      rootComments {
        commentId authorId authorName content headurl timestamp likedCount realLikedCount
        subCommentCount subCommentsPcursor
        subComments {
          commentId authorId authorName content headurl timestamp likedCount realLikedCount
          replyToUserName
        }
      }
    }
  }`;

const KS_PROFILE_QUERY = `
  query visionProfilePhotoList($pcursor: String, $userId: String, $page: String, $webPageArea: String) {
    visionProfilePhotoList(pcursor: $pcursor, userId: $userId, page: $page, webPageArea: $webPageArea) {
      result pcursor
      feeds {
        author { id name }
        photo {${PHOTO_SELECTION} photoUrl duration}
      }
    }
  }`;

export class KuaishouCrawler extends AbstractCrawler {
  public browserContext: BrowserContext | null = null;
  public page: Page | null = null;
  private consecutiveDetailFailures = 0;

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
    if (await this.hasManualVerification()) {
      await this.waitForManualVerification('打开快手首页时触发安全验证');
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
        const sessionCookieNames = ['passToken', 'kuaishou.server.web_st', 'userId', 'kpf', 'did', 'kuaishou.server.web_ph'];
        const hasSession = cookies.some((c) => sessionCookieNames.includes(c.name) && c.value.trim().length > 0);
        if (hasSession) {
          console.log('[KS] Login state confirmed via cookies.');
          return true;
        }
      }
      if (this.page) {
        const loggedInDOM = await this.page.evaluate(() => {
          const hasAvatar = !!document.querySelector('.user-avatar, [class*="avatar"], a[href*="/profile/"], [class*="user-header"], [class*="user-name"]');
          const loginBtn = Array.from(document.querySelectorAll('button, a, p, span')).find(
            (el) => el.textContent?.trim() === '登录'
          );
          return hasAvatar || !loginBtn;
        }).catch(() => false);
        if (loggedInDOM) {
          console.log('[KS] Login state confirmed via DOM.');
          return true;
        }
      }
    } catch (err: any) {
      console.error('[KS] Error checking login state:', err.message);
    }
    return false;
  }

  private async hasManualVerification(): Promise<boolean> {
    const selectors = [
      '[class*="captcha"]',
      '[class*="verify-modal"]',
      '[class*="risk-modal"]',
      'iframe[src*="captcha"]',
      'iframe[src*="verify"]',
    ];
    for (const selector of selectors) {
      if (await this.page!.isVisible(selector, { timeout: 300 }).catch(() => false)) return true;
    }
    const text = await this.page!.locator('body').innerText({ timeout: 1000 }).catch(() => '');
    return /安全验证|拖动滑块|验证码|完成验证|风险验证/.test(text);
  }

  private async waitForManualVerification(reason: string): Promise<void> {
    console.warn(`[KS] Manual verification detected: ${reason}`);
    notifyManualVerificationRequired('kuaishou', reason);
    const startTime = Date.now();
    let stablePasses = 0;
    while (Date.now() - startTime < 180 * 1000) {
      if (await this.hasManualVerification()) {
        stablePasses = 0;
      } else {
        stablePasses++;
        if (stablePasses >= 2) {
          console.log('[KS] Manual verification completed. Resuming...');
          notifyManualVerificationSuccess('kuaishou');
          return;
        }
      }
      await this.page!.waitForTimeout(1000);
    }
    throw new Error('等待快手安全验证超时，请重新运行任务并在 3 分钟内完成验证');
  }

  private async waitForInteractiveLogin(reason: string): Promise<void> {
    console.warn(`[KS] Login is required: ${reason}`);
    notifyLoginRequired('kuaishou', reason);
    const startTime = Date.now();
    while (Date.now() - startTime < 120 * 1000) {
      if (await this.checkLoginState()) {
        console.log('[KS] Login successful. Resuming crawler...');
        notifyLoginSuccess('kuaishou');
        return;
      }
      await this.page!.waitForTimeout(1000);
    }
    throw new Error('快手登录等待超时。请在内置采集浏览器中完成登录后重新运行任务。');
  }

  /**
   * Issues a Kuaishou web GraphQL operation from the crawler page so the request inherits the
   * logged-in cookies and the browser's own TLS/header fingerprint. Transport and risk-control
   * failures are retried (handing captcha or re-login back to the user); a GraphQL schema error
   * fails immediately so callers can fall back to page scraping instead of waiting out retries.
   */
  private async graphql<T = any>(
    operationName: string,
    resultField: string,
    query: string,
    variables: Record<string, any>,
    context: string,
    isOk: (payload: any) => boolean = (payload) => !!payload,
  ): Promise<T> {
    let lastError = '未知错误';
    for (let attempt = 1; attempt <= 3; attempt++) {
      const body: any = await this.page!.evaluate(async ({ operationName, query, variables }) => {
        try {
          const response = await fetch('/graphql', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json;charset=UTF-8' },
            body: JSON.stringify({ operationName, variables, query }),
          });
          if (!response.ok) return { __transportError: `HTTP ${response.status}` };
          return await response.json();
        } catch (error: any) {
          return { __transportError: error?.message || 'fetch failed' };
        }
      }, { operationName, query, variables }).catch((error: any) => ({ __transportError: error?.message || 'evaluate failed' }));

      if (Array.isArray(body?.errors) && body.errors.length) {
        throw new Error(`${context}失败：快手接口返回 GraphQL 错误（${operationName} 的字段可能已变更）：${body.errors[0]?.message}`);
      }
      if (body?.__transportError) {
        lastError = body.__transportError;
      } else {
        const payload = body?.data?.[resultField];
        if (isOk(payload)) return payload as T;
        lastError = `接口拒绝请求（${JSON.stringify(payload ?? null).slice(0, 160)}）`;
      }

      if (attempt === 3) break;
      if (await this.hasManualVerification()) {
        await this.waitForManualVerification(`${context}时触发快手安全验证`);
        continue;
      }
      if (!(await this.checkLoginState())) {
        await this.waitForInteractiveLogin(`${context}时快手判定当前登录已失效`);
        continue;
      }
      await this.humanDelay(this.page!);
    }
    throw new Error(`${context}失败：${lastError}，登录有效但请求被拒绝，可能触发限流或风控`);
  }

  /** Normalises a search / profile feed entry into the stored video record shape. */
  private mapFeed(feed: any, sourceKeyword: string): any | null {
    const photo = feed?.photo;
    const author = feed?.author;
    if (!photo?.id) return null;
    const caption = photo.caption || photo.originCaption || '';
    return {
      video_id: String(photo.id),
      video_type: 'video',
      title: caption,
      desc: caption,
      video_url: `https://www.kuaishou.com/short-video/${photo.id}`,
      video_cover_url: photo.coverUrl || photo.coverUrls?.[0]?.url || '',
      video_play_url: photo.photoUrl || '',
      liked_count: String(photo.realLikeCount ?? photo.likeCount ?? 0),
      viewd_count: String(photo.viewCount ?? 0),
      comment_count: String(photo.commentCount ?? 0),
      creator_hash: String(author?.id || ''),
      nickname: author?.name || '',
      create_time: toEpochSeconds(photo.timestamp),
      source_keyword: sourceKeyword,
    };
  }

  public async search(): Promise<void> {
    const keywords = activeConfig.KEYWORDS.split(',');
    const failures: string[] = [];
    for (const keyword of keywords) {
      console.log(`[KS] Searching keyword: ${keyword}`);
      try {
        const searchUrl = `https://www.kuaishou.com/search/video?searchKey=${encodeURIComponent(keyword)}`;
        if (this.page && (!this.page.url().includes('/search/video') || !this.page.url().includes(encodeURIComponent(keyword)))) {
          await this.page.goto(searchUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
          await this.page.waitForTimeout(1500);
        }

        const videos: any[] = [];
        const seenIds = new Set<string>();
        let pageNumber = Math.max(1, activeConfig.START_PAGE || 1);
        let searchSessionId = '';
        const maxPages = Math.max(1, Math.ceil(activeConfig.CRAWLER_MAX_NOTES_COUNT / 20));
        for (let requestIndex = 0; requestIndex < maxPages && videos.length < activeConfig.CRAWLER_MAX_NOTES_COUNT; requestIndex++) {
          const result = await this.graphql<any>(
            'visionSearchPhoto',
            'visionSearchPhoto',
            KS_SEARCH_QUERY,
            { keyword, pcursor: String(pageNumber), page: 'search', searchSessionId },
            `搜索“${keyword}”`,
            (payload) => payload?.result === 1,
          );
          const feeds = Array.isArray(result.feeds) ? result.feeds : [];
          console.log(`[KS] GraphQL search page ${pageNumber}: ${feeds.length} feeds`);
          for (const feed of feeds) {
            const record = this.mapFeed(feed, keyword);
            if (!record || seenIds.has(record.video_id)) continue;
            seenIds.add(record.video_id);
            videos.push(record);
          }
          if (!feeds.length) break;
          searchSessionId = result.searchSessionId || searchSessionId;
          pageNumber++;
          await this.humanDelay(this.page!);
        }

        console.log(`[KS] Found ${videos.length} videos. Ingesting...`);
        if (!videos.length) throw new Error(`快手未返回“${keyword}”的搜索结果`);
        let count = 0;

        for (const record of videos) {
          if (count >= activeConfig.CRAWLER_MAX_NOTES_COUNT) break;
          await connectorOutput.emitKuaishouVideo(record);
          if (activeConfig.ENABLE_GET_COMMENTS) await this.getVideoComments(record.video_id);
          count++;

          await this.humanDelay(this.page!);
        }
      } catch (err: any) {
        console.error(`[KS] Search error for keyword ${keyword}:`, err.message);
        failures.push(`"${keyword}": ${err.message}`);
      }
    }
    if (failures.length && failures.length === keywords.length) {
      throw new Error(`全部关键词采集失败：${failures.join('；')}`);
    } else if (failures.length) {
      console.warn(`[KS] ${failures.length}/${keywords.length} 个关键词采集失败，其余关键词已正常入库: ${failures.join('；')}`);
    }
  }

  private async fetchVideoDetail(target: string, sourceKeyword: string): Promise<any | null> {
    const resolved = await resolveRedirect(this.page!, target);
    const videoId = firstMatch(resolved, [/\/short-video\/([^/?#]+)/i, /[?&]photoId=([^&#]+)/i]);
    try {
      let record = await this.fetchDetailViaGraphql(videoId, sourceKeyword);
      if (!record) {
        console.warn(`[KS] Detail GraphQL unavailable for ${videoId}; falling back to page scraping.`);
        record = await this.scrapeDetailFromPage(videoId, sourceKeyword);
      }
      await connectorOutput.emitKuaishouVideo(record);
      if (activeConfig.ENABLE_GET_COMMENTS) await this.getVideoComments(record.video_id);
      this.consecutiveDetailFailures = 0;
      return record;
    } catch (error: any) {
      this.consecutiveDetailFailures++;
      console.error(`[KS] Failed to collect detail ${target}: ${error.message}`);
      if (this.consecutiveDetailFailures >= 3 && !(await this.checkLoginState())) {
        throw new Error(`连续 ${this.consecutiveDetailFailures} 个作品采集失败，且登录状态已失效: ${error.message}`);
      }
      return null;
    }
  }

  /** Returns null when the detail operation itself is unusable, so the caller can fall back. */
  private async fetchDetailViaGraphql(videoId: string, sourceKeyword: string): Promise<any | null> {
    try {
      const detail = await this.graphql<any>(
        'visionVideoDetail',
        'visionVideoDetail',
        KS_DETAIL_QUERY,
        { photoId: videoId, page: 'detail', webPageArea: '' },
        `采集作品 ${videoId}`,
        (payload) => !!payload?.photo?.id,
      );
      return this.mapFeed(detail, sourceKeyword);
    } catch (error: any) {
      console.warn(`[KS] visionVideoDetail failed for ${videoId}: ${error.message}`);
      return null;
    }
  }

  private async scrapeDetailFromPage(videoId: string, sourceKeyword: string): Promise<any> {
    const url = `https://www.kuaishou.com/short-video/${encodeURIComponent(videoId)}`;
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
    if (!detail.title && !detail.authorName && !detail.cover) {
      throw new Error('未获取到作品详情数据，页面可能显示登录或风控提示');
    }
    return {
      video_id: String(detail.id || videoId), video_type: 'video', title: detail.title || '', desc: detail.title || '',
      video_url: url, video_cover_url: detail.cover || '', video_play_url: detail.play || '',
      liked_count: String(detail.likes || 0), viewd_count: String(detail.views || 0), comment_count: String(detail.comments || 0),
      creator_hash: String(detail.authorId || ''), nickname: detail.authorName || '',
      create_time: toEpochSeconds(detail.timestamp),
      source_keyword: sourceKeyword,
    };
  }

  private async getVideoComments(videoId: string): Promise<void> {
    try {
      await this.collectCommentsViaGraphql(videoId);
    } catch (error: any) {
      console.error(`[KS] visionCommentList failed for ${videoId}: ${error.message}. Falling back to visible DOM comments.`);
      await this.scrapeVisibleComments(videoId);
    }
  }

  private async collectCommentsViaGraphql(videoId: string): Promise<void> {
    const maxRootComments = Math.max(1, activeConfig.CRAWLER_MAX_COMMENTS_COUNT_SINGLENOTES);
    let rootCount = 0;
    let total = 0;
    const emit = async (comment: any, parentCommentId: string) => {
      const commentId = String(comment?.commentId || '');
      const content = String(comment?.content || '').trim();
      if (!commentId || !content) return;
      await connectorOutput.emitKuaishouComment({
        comment_id: commentId,
        video_id: videoId,
        content,
        create_time: toEpochSeconds(comment.timestamp),
        creator_hash: String(comment.authorId || ''),
        nickname: comment.authorName || '',
        avatar: comment.headurl || '',
        like_count: Number(comment.realLikedCount ?? comment.likedCount ?? 0),
        sub_comment_count: Number(comment.subCommentCount || 0),
        parent_comment_id: parentCommentId,
        reply_to: comment.replyToUserName || '',
      });
      total++;
    };

    let pcursor = '';
    let isFirstPage = true;
    while (rootCount < maxRootComments) {
      const result = await this.graphql<any>(
        'commentListQuery',
        'visionCommentList',
        KS_COMMENT_QUERY,
        { photoId: videoId, pcursor },
        `采集作品 ${videoId} 的评论`,
        (payload) => Array.isArray(payload?.rootComments),
      );
      const roots = result.rootComments as any[];
      for (const root of roots) {
        if (rootCount >= maxRootComments) break;
        await emit(root, '');
        rootCount++;
        if (activeConfig.ENABLE_GET_SUB_COMMENTS) {
          for (const sub of root.subComments || []) await emit(sub, String(root.commentId || ''));
        }
      }
      // Kuaishou answers a throttled or fingerprint-rejected comment query with an empty list
      // rather than an error, so an empty first page is reported instead of passing as success.
      if (isFirstPage && !roots.length) {
        throw new Error(`快手未返回任何评论（commentCount=${result.commentCount ?? '未知'}），可能触发限流或风控`);
      }
      isFirstPage = false;
      pcursor = result.pcursor || '';
      if (!roots.length || !pcursor || pcursor === 'no_more') break;
      await this.humanDelay(this.page!);
    }
    console.log(`[KS] Stored ${total} comments (${rootCount} root) for ${videoId}`);
  }

  private async scrapeVisibleComments(videoId: string): Promise<void> {
    try {
      if (!this.page!.url().includes(`/short-video/${videoId}`)) {
        await this.page!.goto(`https://www.kuaishou.com/short-video/${encodeURIComponent(videoId)}`, { waitUntil: 'domcontentloaded' });
      }
      await this.page!.waitForTimeout(1500);
      const comments = await this.page!.evaluate(() => Array.from(document.querySelectorAll('[data-comment-id]')).map((node) => {
        const user = node.querySelector('[class*="user-name"], [class*="author"]');
        const content = node.querySelector('[class*="comment-content"], [class*="content"]');
        return {
          id: node.getAttribute('data-comment-id') || '',
          content: content?.textContent?.trim() || '',
          nickname: user?.textContent?.trim() || '',
          creatorId: user?.getAttribute('href')?.split('/').pop() || '',
          subCount: Number(node.getAttribute('data-reply-count') || 0),
        };
      }).filter((comment) => comment.id && comment.content));
      for (const comment of comments.slice(0, activeConfig.CRAWLER_MAX_COMMENTS_COUNT_SINGLENOTES)) {
        await connectorOutput.emitKuaishouComment({
          comment_id: comment.id, video_id: videoId, content: comment.content,
          create_time: 0, creator_hash: comment.creatorId,
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
      const records = await this.listCreatorWorksViaGraphql(creatorId);
      if (records === null) {
        console.warn(`[KS] Profile GraphQL unavailable for ${creatorId}; falling back to page scraping.`);
        await this.scrapeCreatorWorksFromPage(creatorId);
        continue;
      }
      console.log(`[KS] Creator ${creatorId}: collected ${records.length} works via GraphQL`);
      for (const record of records) {
        await connectorOutput.emitKuaishouVideo(record);
        if (activeConfig.ENABLE_GET_COMMENTS) await this.getVideoComments(record.video_id);
        await this.humanDelay(this.page!);
      }
    }
  }

  /** Returns null when the profile operation is unusable, so the caller can fall back. */
  private async listCreatorWorksViaGraphql(creatorId: string): Promise<any[] | null> {
    const limit = Math.max(1, activeConfig.CRAWLER_MAX_NOTES_COUNT);
    const records: any[] = [];
    const seenIds = new Set<string>();
    let pcursor = '';
    try {
      while (records.length < limit) {
        const result = await this.graphql<any>(
          'visionProfilePhotoList',
          'visionProfilePhotoList',
          KS_PROFILE_QUERY,
          { userId: creatorId, pcursor, page: 'profile', webPageArea: '' },
          `采集创作者 ${creatorId} 的作品列表`,
          (payload) => Array.isArray(payload?.feeds),
        );
        const feeds = result.feeds as any[];
        for (const feed of feeds) {
          if (records.length >= limit) break;
          const record = this.mapFeed(feed, `创作者:${creatorId}`);
          if (!record || seenIds.has(record.video_id)) continue;
          seenIds.add(record.video_id);
          records.push(record);
        }
        pcursor = result.pcursor || '';
        if (!feeds.length || !pcursor || pcursor === 'no_more') break;
        await this.humanDelay(this.page!);
      }
      return records;
    } catch (error: any) {
      console.warn(`[KS] visionProfilePhotoList failed for ${creatorId}: ${error.message}`);
      return records.length ? records : null;
    }
  }

  private async scrapeCreatorWorksFromPage(creatorId: string): Promise<void> {
    await this.page!.goto(`https://www.kuaishou.com/profile/${encodeURIComponent(creatorId)}`, { waitUntil: 'domcontentloaded' });
    await this.page!.waitForTimeout(2200);
    const ids = await this.page!.evaluate(() => Array.from(document.querySelectorAll('a[href*="/short-video/"]'))
      .map((link) => link.getAttribute('href')?.match(/\/short-video\/([^/?#]+)/)?.[1] || '').filter(Boolean));
    const unique = [...new Set(ids)].slice(0, activeConfig.CRAWLER_MAX_NOTES_COUNT);
    console.log(`[KS] Creator ${creatorId}: discovered ${unique.length} works`);
    for (const id of unique) await this.fetchVideoDetail(id, `创作者:${creatorId}`);
  }
}
