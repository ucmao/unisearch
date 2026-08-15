import { createHash } from 'crypto';
import * as cheerio from 'cheerio';
import { AbstractCrawler } from '../base/BaseCrawler';
import { systemHttpClient } from '../base/SystemHttpClient';
import { activeConfig } from '../../tools/config';
import { connectorOutput } from '../../connectors/output/connector-output';
import { ConnectorRuntimeError } from '../../core/contracts/errors';

const GATEWAY_SEARCH_URL = 'https://gateway.36kr.com/api/mis/nav/search/result';
const GATEWAY_NEWSFLASH_URL = 'https://gateway.36kr.com/api/mis/nav/newsflash/flow';
const GATEWAY_HOT_RANK_URL = 'https://gateway.36kr.com/api/mis/nav/home/nav/rank/hot';

type JsonRecord = Record<string, any>;

function stableId(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

function cleanText(value: unknown): string {
  return String(value || '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeKr36Target(value: string): string {
  const target = value.trim();
  if (!target) throw new ConnectorRuntimeError('INVALID_INPUT', '36氪文章链接或 ID 不能为空');

  if (/^https?:\/\//i.test(target)) {
    try {
      const url = new URL(target);
      const segments = url.pathname.split('/').filter(Boolean);
      // Handles /p/123456, /p/123456.html, /newsflashes/123456
      const last = segments.at(-1) || '';
      const cleanId = last.replace(/\.html$/i, '');
      if (cleanId && /^\d+$/.test(cleanId)) return cleanId;
      if (cleanId) return cleanId;
    } catch {
      // Fall through to raw target
    }
  }

  const numeric = target.replace(/^[^\d]*/, '').replace(/\.html$/i, '');
  if (numeric && /^\d+$/.test(numeric)) return numeric;
  return target;
}

export function mapKr36Article(item: JsonRecord, keyword = ''): JsonRecord {
  const tm = item.templateMaterial || {};
  let parsedId = item.itemId || item.id || tm.itemId;
  if (!parsedId && typeof item.route === 'string') {
    const match = item.route.match(/itemId=(\d+)/i);
    if (match) parsedId = match[1];
  }
  const itemId = String(parsedId || stableId(item.widgetTitle || item.title || tm.widgetTitle || ''));
  const title = cleanText(item.widgetTitle || item.title || tm.widgetTitle || '');
  const summary = cleanText(item.summary || tm.summary || item.widgetContent || item.content || '');
  const description = cleanText(item.widgetContent || item.content || summary || '');
  const authorName = String(item.author || tm.authorName || item.user?.name || '36氪');
  const authorId = String(item.authorId || tm.authorId || item.userId || '');
  const coverUrl = item.widgetImage || tm.widgetImage || item.coverUrl || item.cover || undefined;
  const publishTime = Number(item.publishTime || tm.publishTime || item.publish_time || Date.now());
  const contentUrl = itemId && /^\d+$/.test(itemId)
    ? `https://36kr.com/p/${itemId}`
    : (keyword ? `https://36kr.com/search/articles/${encodeURIComponent(keyword)}` : 'https://36kr.com');

  const citations: Array<{ url: string; title?: string; source?: string }> = [
    {
      url: contentUrl,
      title: title || '36氪文章',
      source: '36氪',
    },
  ];

  return {
    content_id: itemId,
    title,
    summary,
    description,
    creator_id: authorId || undefined,
    creator_name: authorName,
    content_url: contentUrl,
    published_at: publishTime,
    cover_url: coverUrl,
    column_name: String(item.columnName || tm.columnName || item.channelName || '商业科技'),
    likes: Number(item.likeCount || item.likes || tm.likeCount || 0),
    comments: Number(item.commentCount || item.comments || tm.commentCount || 0),
    views: Number(item.viewCount || item.views || tm.viewCount || 0),
    shares: Number(item.shareCount || item.shares || 0),
    source_keyword: keyword || undefined,
    citations,
    content_mode: 'article',
    language: 'zh-CN',
  };
}

export function mapKr36NewsFlash(item: JsonRecord): JsonRecord {
  const tm = item.templateMaterial || {};
  let parsedId = item.itemId || item.id || tm.itemId;
  if (!parsedId && typeof item.route === 'string') {
    const match = item.route.match(/itemId=(\d+)/i);
    if (match) parsedId = match[1];
  }
  const itemId = String(parsedId || stableId(item.widgetTitle || item.title || tm.widgetTitle || ''));
  const title = cleanText(item.widgetTitle || item.title || tm.widgetTitle || '');
  const description = cleanText(item.widgetContent || item.content || tm.widgetContent || title);
  const summary = description.slice(0, 150);
  const publishTime = Number(item.publishTime || tm.publishTime || Date.now());
  const contentUrl = `https://36kr.com/newsflashes/${itemId}`;

  return {
    content_id: itemId,
    title: title || '36氪快讯',
    summary,
    description,
    creator_name: '36氪快讯',
    content_url: contentUrl,
    published_at: publishTime,
    column_name: '7x24h快讯',
    citations: [{ url: contentUrl, title: title || '36氪快讯', source: '36氪' }],
    content_mode: 'newsflash',
    language: 'zh-CN',
  };
}

export function mapKr36HotTopic(item: JsonRecord, rank: number): JsonRecord {
  const tm = item.templateMaterial || {};
  let parsedId = item.itemId || item.id || tm.itemId;
  if (!parsedId && typeof item.route === 'string') {
    const match = item.route.match(/itemId=(\d+)/i);
    if (match) parsedId = match[1];
  }
  const itemId = String(parsedId || stableId(item.widgetTitle || item.title || tm.widgetTitle || ''));
  const title = cleanText(item.widgetTitle || item.title || tm.widgetTitle || '');
  const summary = cleanText(item.summary || tm.summary || `36氪 24小时热门榜单第 ${rank} 位`);
  const contentUrl = itemId && /^\d+$/.test(itemId) ? `https://36kr.com/p/${itemId}` : 'https://36kr.com/hot-list/catalog';

  return {
    content_id: itemId,
    title,
    summary,
    description: summary,
    creator_name: String(item.author || tm.authorName || '36氪'),
    content_url: contentUrl,
    published_at: Number(item.publishTime || tm.publishTime || Date.now()),
    rank,
    column_name: '24h人气榜',
    citations: [{ url: contentUrl, title, source: '36氪' }],
    content_mode: 'hot_topics',
    language: 'zh-CN',
  };
}

export class Kr36Crawler extends AbstractCrawler {
  public async search(): Promise<void> {
    await this.start();
  }

  private maxItems(): number {
    return Math.max(1, Math.min(100, Number(activeConfig.CRAWLER_MAX_NOTES_COUNT || 20)));
  }

  private async fetchItems(): Promise<void> {
    const keywords = String(activeConfig.KEYWORDS || '')
      .split(/[,，\n]+/)
      .map((val) => val.trim())
      .filter(Boolean);
    const queries = keywords.length ? keywords : ['商业'];
    const maxItems = this.maxItems();

    for (const keyword of queries) {
      let emitted = 0;
      try {
        const response = await systemHttpClient.post(GATEWAY_SEARCH_URL, {
          partner_id: 'wap',
          param: {
            siteId: 1,
            platformId: 2,
            searchType: 'article',
            searchWord: keyword,
            pageEvent: 0,
            pageSize: Math.min(50, Math.max(20, maxItems)),
          },
        }, {
          headers: {
            'Content-Type': 'application/json;charset=utf-8',
            'Origin': 'https://36kr.com',
            'Referer': `https://36kr.com/search/articles/${encodeURIComponent(keyword)}`,
          },
          timeout: 10000,
        });

        const articleData = response?.data?.data?.article || {};
        const itemList = Array.isArray(articleData.itemList) ? articleData.itemList : [];

        for (const item of itemList) {
          const mapped = mapKr36Article(item, keyword);
          await connectorOutput.emitKr36Result(mapped);
          emitted++;
          if (emitted >= maxItems) break;
        }
      } catch (err: any) {
        console.warn(`[Kr36Crawler] 检索关键词 "${keyword}" 失败: ${err.message}`);
      }

      console.log(`[Kr36Crawler] 关键词 "${keyword}" 采集完成，共获取 ${emitted} 条 36氪 文章`);
    }
  }

  private async fetchHotTopics(): Promise<void> {
    const maxItems = this.maxItems();
    try {
      const response = await systemHttpClient.post(GATEWAY_HOT_RANK_URL, {
        partner_id: 'wap',
        param: { siteId: 1, platformId: 2 },
      }, {
        headers: {
          'Content-Type': 'application/json;charset=utf-8',
          'Origin': 'https://36kr.com',
          'Referer': 'https://36kr.com/hot-list/catalog',
        },
        timeout: 10000,
      });

      const list = Array.isArray(response?.data?.data?.hotRankList) ? response.data.data.hotRankList : [];
      const selected = list.slice(0, maxItems);
      for (const [index, item] of selected.entries()) {
        await connectorOutput.emitKr36Result(mapKr36HotTopic(item, index + 1));
      }
      console.log(`[Kr36Crawler] 采集完成，获取 ${selected.length} 条 36氪 24h 人气榜单`);
    } catch (err: any) {
      console.error(`[Kr36Crawler] 获取 36氪 热榜失败: ${err.message}`);
      throw err;
    }
  }

  private async fetchNewsFlashes(): Promise<void> {
    const maxItems = this.maxItems();
    try {
      const response = await systemHttpClient.post(GATEWAY_NEWSFLASH_URL, {
        partner_id: 'wap',
        param: {
          siteId: 1,
          platformId: 2,
          pageEvent: 0,
          pageSize: Math.min(50, maxItems),
          isFirst: 1,
        },
      }, {
        headers: {
          'Content-Type': 'application/json;charset=utf-8',
          'Origin': 'https://36kr.com',
          'Referer': 'https://36kr.com/newsflashes',
        },
        timeout: 10000,
      });

      const list = Array.isArray(response?.data?.data?.itemList) ? response.data.data.itemList : [];
      const selected = list.slice(0, maxItems);
      for (const item of selected) {
        await connectorOutput.emitKr36Result(mapKr36NewsFlash(item));
      }
      console.log(`[Kr36Crawler] 采集完成，获取 ${selected.length} 条 36氪 24h 快讯`);
    } catch (err: any) {
      console.error(`[Kr36Crawler] 获取 36氪 快讯失败: ${err.message}`);
      throw err;
    }
  }

  private async fetchDetails(): Promise<void> {
    const rawTargets = Array.isArray(activeConfig.SPECIFIED_IDS)
      ? activeConfig.SPECIFIED_IDS
      : String(activeConfig.SPECIFIED_IDS || '').split(/[,，\n]+/).map((v) => v.trim()).filter(Boolean);

    if (!rawTargets.length) {
      throw new ConnectorRuntimeError('INVALID_INPUT', '请提供至少一个 36氪 文章链接或 ID');
    }

    for (const target of rawTargets) {
      const itemId = normalizeKr36Target(String(target));
      try {
        const response = await systemHttpClient.get(`https://m.36kr.com/p/${itemId}`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
          },
          timeout: 10000,
        });

        const $ = cheerio.load(response.data);
        $('script, style, noscript').remove();
        const fullText = $('body').text().replace(/\s+/g, ' ').trim();
        const title = $('h1').text().trim() || cleanText(fullText.slice(0, 60));
        const summary = cleanText(fullText.slice(0, 200));

        const mapped = mapKr36Article({
          itemId,
          widgetTitle: title,
          summary,
          widgetContent: fullText,
        });

        await connectorOutput.emitKr36Result(mapped);
        console.log(`[Kr36Crawler] 成功提取 36氪 文章详情：${itemId} (${mapped.title})`);
      } catch (err: any) {
        console.warn(`[Kr36Crawler] 提取 36氪 文章详情 ${itemId} 失败: ${err.message}`);
      }
    }
  }

  public async start(): Promise<void> {
    console.log('[Kr36Crawler] 启动 36氪 商业创投数据连接器...');
    if (activeConfig.CRAWLER_TYPE === 'detail') {
      await this.fetchDetails();
      return;
    }

    if (activeConfig.KR36_CONTENT_MODE === 'hot_topics') {
      await this.fetchHotTopics();
    } else if (activeConfig.KR36_CONTENT_MODE === 'newsflashes') {
      await this.fetchNewsFlashes();
    } else {
      await this.fetchItems();
    }
  }
}
