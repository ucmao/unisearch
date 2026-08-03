import { BrowserContext, Page } from 'playwright';
import { AbstractCrawler, connectToElectronChromium, getElectronCrawlerPage, notifyLoginQrCodeRequired, notifyLoginSuccess } from '../base/BaseCrawler';
import { activeConfig } from '../../tools/config';
import { connectorOutput } from '../../connectors/output/connector-output';
import { BiliWbiSigner } from '../base/biliWbiSigner';
import {
  asAbsoluteUrl,
  configuredTargets,
  creatorItemLimit,
  creatorLimitReached,
  firstMatch,
  reportKeywordSearchCompletion,
  resolveRedirect,
  stripHtml,
} from '../base/connectorHelpers';

const SEARCH_API = 'https://api.bilibili.com/x/web-interface/wbi/search/type';
const SPACE_API = 'https://api.bilibili.com/x/space/wbi/arc/search';
const API_PAGE_SIZE = 30;
/** Stop paging even if the API keeps claiming there is more. */
const MAX_API_PAGES = 50;

/** A video as gathered from search/space, before stat enrichment. */
interface BiliVideoSeed {
  video_id: string;
  aid: string;
  video_url: string;
  title: string;
  desc: string;
  nickname: string;
  creator_hash: string;
  create_time: number;
  video_play_count: string;
  video_danmaku: string;
  video_favorite_count: string;
  video_comment: string;
  video_cover_url: string;
}

export class BilibiliCrawler extends AbstractCrawler {
  public browserContext: BrowserContext | null = null;
  public page: Page | null = null;
  private signer: BiliWbiSigner | null = null;

  public async start(): Promise<void> {
    console.log('[BILI] Starting Bilibili crawler (Electron CDP mode)...');
    
    const p = require('playwright');
    this.browserContext = await connectToElectronChromium(p);
    this.page = await getElectronCrawlerPage(this.browserContext, 'bili');
    this.signer = new BiliWbiSigner(this.page);




    await this.page.goto('https://www.bilibili.com', { waitUntil: 'domcontentloaded' });
    await this.handleLogin();

    if (activeConfig.CRAWLER_TYPE === 'search') {
      await this.search();
    } else if (activeConfig.CRAWLER_TYPE === 'detail') {
      await this.getSpecifiedVideos();
    } else if (activeConfig.CRAWLER_TYPE === 'creator') {
      await this.getCreatorsAndVideos();
    }

    console.log('[BILI] Bilibili crawler finished.');
  }

  private async handleLogin(): Promise<void> {
    console.log('[BILI] Checking login state...');
    if (activeConfig.LOGIN_TYPE === 'cookie' && activeConfig.COOKIES) {
      await this.applyCookieHeader(this.browserContext!, activeConfig.COOKIES, '.bilibili.com');
      await this.page!.reload({ waitUntil: 'domcontentloaded' });
    }
    let isLoggedIn = await this.checkLoginState();
    
    if (!isLoggedIn && activeConfig.LOGIN_TYPE === 'qrcode') {
      console.log('[BILI] User is not logged in. Triggering login dialog...');
      try {
        await this.page!.click('div.header-login-entry, .header-avatar-wrap', { timeout: 3000 });
      } catch {
        // Ignored
      }
      
      await new Promise((r) => setTimeout(r, 1500));
      // Capture QR code image / modal screenshot
      try {
        let qrBase64 = '';
        const qrEl = await this.page!.$('.bili-mini-login-pop, .login-scan-box, div.qrcode-img, canvas');
        if (qrEl) {
          const buf = await qrEl.screenshot({ type: 'png' });
          qrBase64 = `data:image/png;base64,${buf.toString('base64')}`;
        } else {
          const buf = await this.page!.screenshot({ type: 'png' });
          qrBase64 = `data:image/png;base64,${buf.toString('base64')}`;
        }
        notifyLoginQrCodeRequired('bili', qrBase64);
      } catch (err: any) {
        console.error('[BILI] Failed to capture QR code:', err.message);
      }

      console.log('[BILI] Waiting for user to scan Bilibili QR code...');
      const startTime = Date.now();
      while (Date.now() - startTime < 120 * 1000) {
        isLoggedIn = await this.checkLoginState();
        if (isLoggedIn) {
          console.log('[BILI] Login successful!');
          notifyLoginSuccess('bili');
          break;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }


  private async checkLoginState(): Promise<boolean> {
    try {
      const visible = await this.page!.isVisible('.header-avatar-wrap, a.header-entry-avatar', { timeout: 1000 });
      if (visible) return true;
    } catch {}
    try {
      const isLoginBtn = await this.page!.isVisible('div.header-login-entry', { timeout: 1000 });
      if (isLoginBtn) return false;
    } catch {}
    try {
      if (this.browserContext) {
        const cookies = await this.browserContext.cookies();
        const hasSession = cookies.some((c) => c.name === 'SESSDATA' || c.name === 'DedeUserID');
        if (hasSession) {
          const loginBtnExists = await this.page!.isVisible('div.header-login-entry', { timeout: 1000 }).catch(() => false);
          if (loginBtnExists) return false;
          console.log('[BILI] Login state confirmed via cookies.');
          return true;
        }
      }
    } catch (err: any) {
      console.error('[BILI] Error checking cookies:', err.message);
    }
    return false;
  }

  public async search(): Promise<void> {
    const keywords = activeConfig.KEYWORDS.split(',');
    for (const keyword of keywords) {
      console.log(`[BILI] Searching keyword: ${keyword}`);
      try {
        const seeds = await this.executeHybrid<BiliVideoSeed>(
          () => this.searchViaApi(keyword),
          () => this.searchViaDom(keyword)
        );
        console.log(`[BILI] Found ${seeds.length} videos. Ingesting...`);
        for (const seed of seeds) {
          await this.ingestSeed(seed, keyword);
          await this.humanDelay(this.page!);
        }
        reportKeywordSearchCompletion('哔哩哔哩', keyword, seeds.length, activeConfig.CRAWLER_MAX_NOTES_COUNT,
          '平台已返回末页或搜索接口提前停止');
      } catch (err: any) {
        console.error(`[BILI] Search error for keyword ${keyword}:`, err.message);
      }
    }
  }

  /** Paged search through the signed API — the primary path. */
  private async searchViaApi(keyword: string): Promise<BiliVideoSeed[]> {
    const limit = activeConfig.CRAWLER_MAX_NOTES_COUNT;
    const seeds: BiliVideoSeed[] = [];
    const seen = new Set<string>();

    for (let pageNum = 1; seeds.length < limit && pageNum <= MAX_API_PAGES; pageNum++) {
      const data = await this.signer!.get(SEARCH_API, {
        search_type: 'video',
        keyword,
        page: pageNum,
        page_size: API_PAGE_SIZE,
      });
      const results: any[] = data?.result || [];
      if (!results.length) break;

      for (const item of results) {
        const seed = this.seedFromSearchItem(item);
        if (!seed || seen.has(seed.video_id)) continue;
        seen.add(seed.video_id);
        seeds.push(seed);
        if (seeds.length >= limit) break;
      }
      if (results.length < API_PAGE_SIZE) break;
      await this.humanDelay(this.page!);
    }
    return seeds;
  }

  private seedFromSearchItem(item: any): BiliVideoSeed | null {
    const bvid = item?.bvid || '';
    const aid = item?.aid ? String(item.aid) : '';
    if (!bvid && !aid) return null;
    return {
      video_id: bvid || `av${aid}`,
      aid,
      video_url: item.arcurl || `https://www.bilibili.com/video/${bvid || `av${aid}`}`,
      // Search echoes the query back wrapped in <em class="keyword"> highlights.
      title: stripHtml(item.title),
      desc: stripHtml(item.description),
      nickname: item.author || '',
      creator_hash: item.mid ? String(item.mid) : '',
      create_time: Number(item.pubdate || 0),
      video_play_count: String(item.play ?? 0),
      video_danmaku: String(item.video_review ?? 0),
      video_favorite_count: String(item.favorites ?? 0),
      video_comment: String(item.review ?? 0),
      video_cover_url: item.pic ? asAbsoluteUrl(item.pic, 'https://i0.hdslb.com') : '',
    };
  }

  /** Legacy DOM scrape, kept as the fallback when the API is blocked. */
  private async searchViaDom(keyword: string): Promise<BiliVideoSeed[]> {
    const searchUrl = `https://search.bilibili.com/all?keyword=${encodeURIComponent(keyword)}`;
    await this.page!.goto(searchUrl, { waitUntil: 'domcontentloaded' });
    await this.page!.waitForTimeout(3000);

    // Scroll to load cards
    await this.page!.evaluate(() => window.scrollBy(0, 800));
    await this.page!.waitForTimeout(1000);

    const cards = await this.page!.evaluate(() => {
      const items: any[] = [];
      document.querySelectorAll('.video-list-item, .bili-video-card').forEach((card) => {
        const titleEl = card.querySelector('h3.title, .bili-video-card__info--tit');
        const linkEl = card.querySelector('a[href*="video/BV"]');
        const authorEl = card.querySelector('.up-name, .bili-video-card__info--author');
        const watchEl = card.querySelector('.watch-num, .bili-video-card__info--play');

        if (titleEl && linkEl) {
          const href = linkEl.getAttribute('href') || '';
          items.push({
            video_id: href.match(/video\/(BV[a-zA-Z0-9]+)/)?.[1] || '',
            title: titleEl.textContent?.trim() || '',
            video_url: href.startsWith('http') ? href : 'https:' + href,
            nickname: authorEl?.textContent?.trim() || '',
            creator_hash: authorEl?.getAttribute('href')?.split('/').pop() || '',
            video_play_count: watchEl?.textContent?.trim() || '0',
          });
        }
      });
      return items;
    });

    return cards
      .filter((card: any) => card.video_id)
      .slice(0, activeConfig.CRAWLER_MAX_NOTES_COUNT)
      .map((card: any) => ({
        video_id: card.video_id,
        aid: '',
        video_url: card.video_url,
        title: card.title,
        desc: card.title,
        nickname: card.nickname,
        creator_hash: card.creator_hash,
        create_time: 0,
        video_play_count: card.video_play_count,
        video_danmaku: '0',
        video_favorite_count: '0',
        video_comment: '0',
        video_cover_url: '',
      }));
  }

  /**
   * Emit a seed, topping it up from the `view` endpoint.
   *
   * Search and space payloads carry play/danmaku/favorite/reply but not
   * like/coin/share/dislike, so `view` still runs — but a failure now degrades
   * to the seed's own fields instead of dropping the record.
   */
  private async ingestSeed(seed: BiliVideoSeed, sourceKeyword: string): Promise<void> {
    let detail: any = {};
    try {
      const identifier = seed.video_id.startsWith('BV')
        ? `bvid=${encodeURIComponent(seed.video_id)}`
        : `aid=${encodeURIComponent(seed.aid)}`;
      const res = await this.page!.evaluate(
        async (url) => (await fetch(url, { credentials: 'include' })).json(),
        `https://api.bilibili.com/x/web-interface/view?${identifier}`
      );
      if (res && res.code === 0 && res.data) detail = res.data;
    } catch (e: any) {
      console.error(`[BILI] Failed to fetch details for ${seed.video_id}:`, e.message);
    }

    await connectorOutput.emitBilibiliVideo({
      video_id: seed.video_id,
      video_url: seed.video_url,
      creator_hash: detail.owner?.mid ? String(detail.owner.mid) : seed.creator_hash,
      nickname: detail.owner?.name || seed.nickname,
      liked_count: Number(detail.stat?.like || 0),
      video_type: 'video',
      title: detail.title || seed.title,
      desc: detail.desc || seed.desc,
      create_time: detail.pubdate || seed.create_time || Math.floor(Date.now() / 1000),
      disliked_count: String(detail.stat?.dislike || 0),
      video_play_count: String(detail.stat?.view ?? seed.video_play_count),
      video_favorite_count: String(detail.stat?.favorite ?? seed.video_favorite_count),
      video_share_count: String(detail.stat?.share || 0),
      video_coin_count: String(detail.stat?.coin || 0),
      video_danmaku: String(detail.stat?.danmaku ?? seed.video_danmaku),
      video_comment: String(detail.stat?.reply ?? seed.video_comment),
      video_cover_url: detail.pic || seed.video_cover_url,
      source_keyword: sourceKeyword,
    });

    // Search already hands us the aid, so comments no longer depend on `view`.
    const aid = detail.aid ? String(detail.aid) : seed.aid;
    if (activeConfig.ENABLE_GET_COMMENTS && aid) {
      await this.getVideoComments(aid, seed.video_id);
    }
  }

  private async fetchVideoDetail(target: string, sourceKeyword: string): Promise<any | null> {
    const resolved = await resolveRedirect(this.page!, target);
    const bvid = firstMatch(resolved, [/video\/(BV[a-zA-Z0-9]+)/i, /\b(BV[a-zA-Z0-9]+)\b/i]);
    const aid = firstMatch(resolved, [/video\/av(\d+)/i, /\bav(\d+)\b/i, /[?&]aid=(\d+)/i, /^\s*(\d+)\s*$/]);
    const useBvid = /^BV/i.test(bvid);
    const apiUrl = useBvid
      ? `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`
      : `https://api.bilibili.com/x/web-interface/view?aid=${encodeURIComponent(aid)}`;
    const result = await this.page!.evaluate(async (url) => (await fetch(url)).json(), apiUrl);
    if (!result || result.code !== 0 || !result.data) {
      console.error(`[BILI] Detail API rejected target ${target}: ${result?.message || result?.code || 'unknown'}`);
      return null;
    }
    const detail = result.data;
    const video = {
      video_id: detail.bvid || String(detail.aid),
      video_url: `https://www.bilibili.com/video/${detail.bvid || `av${detail.aid}`}`,
      creator_hash: String(detail.owner?.mid || ''),
      nickname: detail.owner?.name || '',
      liked_count: Number(detail.stat?.like || 0),
      video_type: 'video',
      title: detail.title || '',
      desc: detail.desc || '',
      create_time: detail.pubdate || 0,
      disliked_count: String(detail.stat?.dislike || 0),
      video_play_count: String(detail.stat?.view || 0),
      video_favorite_count: String(detail.stat?.favorite || 0),
      video_share_count: String(detail.stat?.share || 0),
      video_coin_count: String(detail.stat?.coin || 0),
      video_danmaku: String(detail.stat?.danmaku || 0),
      video_comment: String(detail.stat?.reply || 0),
      video_cover_url: detail.pic || '',
      source_keyword: sourceKeyword,
    };
    await connectorOutput.emitBilibiliVideo(video);
    if (activeConfig.ENABLE_GET_COMMENTS) await this.getVideoComments(String(detail.aid), video.video_id);
    return video;
  }

  private async getVideoComments(aid: string, videoId: string): Promise<void> {
    const pageSize = Math.min(activeConfig.CRAWLER_MAX_COMMENTS_COUNT_SINGLENOTES, 49);
    const url = `https://api.bilibili.com/x/v2/reply?type=1&oid=${encodeURIComponent(aid)}&pn=1&ps=${pageSize}&sort=2`;
    try {
      const result = await this.page!.evaluate(async (apiUrl) => (await fetch(apiUrl)).json(), url);
      if (!result || result.code !== 0) {
        throw new Error(result?.message || `Bilibili API code ${result?.code ?? 'unknown'}`);
      }
      const replies = result?.data?.replies || [];
      for (const reply of replies.slice(0, activeConfig.CRAWLER_MAX_COMMENTS_COUNT_SINGLENOTES)) {
        await connectorOutput.emitBilibiliComment({
          comment_id: String(reply.rpid || ''), video_id: videoId, content: reply.content?.message || '',
          create_time: reply.ctime || 0, creator_hash: String(reply.mid || ''), nickname: reply.member?.uname || '',
          sub_comment_count: reply.rcount || 0, parent_comment_id: '', like_count: reply.like || 0,
        });
        // The reply endpoint previews each thread's replies in the same payload.
        for (const child of (reply.replies || [])) {
          await connectorOutput.emitBilibiliComment({
            comment_id: String(child.rpid || ''), video_id: videoId, content: child.content?.message || '',
            create_time: child.ctime || 0, creator_hash: String(child.mid || ''), nickname: child.member?.uname || '',
            sub_comment_count: 0, parent_comment_id: String(reply.rpid || ''), like_count: child.like || 0,
          });
        }
      }
      console.log(`[BILI] Stored ${replies.length} comments for ${videoId}`);
    } catch (error: any) {
      console.error(`[BILI] Failed to collect comments for ${videoId}: ${error.message}`);
    }
  }

  public async getSpecifiedVideos(): Promise<void> {
    const targets = configuredTargets('bili', 'detail');
    for (const target of targets) await this.fetchVideoDetail(target, '指定作品');
  }

  public async getCreatorsAndVideos(): Promise<void> {
    for (const target of configuredTargets('bili', 'creator')) {
      const mid = firstMatch(target, [/space\.bilibili\.com\/(\d+)/i, /\b(\d+)\b/]);
      const seeds = await this.executeHybrid<BiliVideoSeed>(
        () => this.creatorVideosViaApi(mid),
        () => this.creatorVideosViaDom(mid)
      );
      console.log(`[BILI] Creator ${mid}: discovered ${seeds.length} videos`);
      for (const seed of seeds) {
        await this.ingestSeed(seed, `UP:${mid}`);
        await this.humanDelay(this.page!);
      }
    }
  }

  /** Paged creator archive through the signed API — the primary path. */
  private async creatorVideosViaApi(mid: string): Promise<BiliVideoSeed[]> {
    const limit = creatorItemLimit();
    const seeds: BiliVideoSeed[] = [];
    const seen = new Set<string>();

    for (let pageNum = 1; !creatorLimitReached(seeds.length, limit); pageNum++) {
      const before = seeds.length;
      const data = await this.signer!.get(SPACE_API, {
        mid,
        ps: API_PAGE_SIZE,
        pn: pageNum,
        order: 'pubdate',
        index: 1,
      });
      const vlist: any[] = data?.list?.vlist || [];
      if (!vlist.length) break;

      for (const item of vlist) {
        const seed = this.seedFromSpaceItem(item, mid);
        if (!seed || seen.has(seed.video_id)) continue;
        seen.add(seed.video_id);
        seeds.push(seed);
        if (creatorLimitReached(seeds.length, limit)) break;
      }
      const total = Number(data?.page?.count || 0);
      if (seeds.length === before) {
        console.warn(`[BILI] Creator page ${pageNum} added no new videos; stopping to avoid a pagination loop.`);
        break;
      }
      if (vlist.length < API_PAGE_SIZE || pageNum * API_PAGE_SIZE >= total) break;
      await this.humanDelay(this.page!);
    }
    return seeds;
  }

  private seedFromSpaceItem(item: any, mid: string): BiliVideoSeed | null {
    const bvid = item?.bvid || '';
    const aid = item?.aid ? String(item.aid) : '';
    if (!bvid && !aid) return null;
    return {
      video_id: bvid || `av${aid}`,
      aid,
      video_url: `https://www.bilibili.com/video/${bvid || `av${aid}`}`,
      title: stripHtml(item.title),
      desc: stripHtml(item.description),
      nickname: item.author || '',
      creator_hash: item.mid ? String(item.mid) : mid,
      create_time: Number(item.created || 0),
      video_play_count: String(item.play ?? 0),
      video_danmaku: String(item.video_review ?? 0),
      video_favorite_count: '0',
      video_comment: String(item.comment ?? 0),
      video_cover_url: item.pic ? asAbsoluteUrl(item.pic, 'https://i0.hdslb.com') : '',
    };
  }

  /** Legacy DOM scrape of the space page, kept as the fallback. */
  private async creatorVideosViaDom(mid: string): Promise<BiliVideoSeed[]> {
    await this.page!.goto(`https://space.bilibili.com/${encodeURIComponent(mid)}/video`, { waitUntil: 'domcontentloaded' });
    await this.page!.waitForTimeout(2500);
    const limit = creatorItemLimit();
    const bvids = new Set<string>();
    let stagnantRounds = 0;
    while (!creatorLimitReached(bvids.size, limit) && stagnantRounds < 4) {
      const visible = await this.page!.evaluate(() => Array.from(document.querySelectorAll('a[href*="/video/BV"]'))
        .map((link) => link.getAttribute('href')?.match(/\/video\/(BV[a-zA-Z0-9]+)/)?.[1] || '')
        .filter(Boolean));
      const before = bvids.size;
      for (const bvid of visible) {
        bvids.add(bvid);
        if (creatorLimitReached(bvids.size, limit)) break;
      }
      stagnantRounds = bvids.size > before ? 0 : stagnantRounds + 1;
      if (!creatorLimitReached(bvids.size, limit)) {
        await this.page!.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await this.page!.waitForTimeout(1200);
      }
    }
    return [...bvids]
      .map((bvid) => ({
        video_id: bvid,
        aid: '',
        video_url: `https://www.bilibili.com/video/${bvid}`,
        title: '',
        desc: '',
        nickname: '',
        creator_hash: mid,
        create_time: 0,
        video_play_count: '0',
        video_danmaku: '0',
        video_favorite_count: '0',
        video_comment: '0',
        video_cover_url: '',
      }));
  }
}
