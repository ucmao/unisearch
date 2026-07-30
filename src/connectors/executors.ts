import { BilibiliCrawler } from '../crawler/platforms/bili';
import { DouyinCrawler } from '../crawler/platforms/douyin';
import { KuaishouCrawler } from '../crawler/platforms/kuaishou';
import { TiebaCrawler } from '../crawler/platforms/tieba';
import { WeiboCrawler } from '../crawler/platforms/weibo';
import { XiaoHongShuCrawler } from '../crawler/platforms/xhs';
import { ZhihuCrawler } from '../crawler/platforms/zhihu';
import { BaiduCrawler, BingCrawler, So360Crawler, SogouCrawler, ToutiaoCrawler } from '../crawler/platforms/search_engine';
import { MediaParserCrawler } from '../crawler/platforms/media_parser';
import { ZhaopinCrawler } from '../crawler/platforms/zhaopin';
import { Job51Crawler } from '../crawler/platforms/job51';
import { LiepinCrawler } from '../crawler/platforms/liepin';
import { BossCrawler } from '../crawler/platforms/boss';
import { HeimaoCrawler } from '../crawler/platforms/heimao';
import { DeepSeekCrawler } from '../crawler/platforms/deepseek';
import { KimiCrawler } from '../crawler/platforms/kimi';
import { DoubaoCrawler } from '../crawler/platforms/doubao';
import { QwenCrawler } from '../crawler/platforms/qwen';
import { NamiCrawler, WenxinCrawler, YuanbaoCrawler } from '../crawler/platforms/china_ai_web_qa';
import { AiHotCrawler } from '../crawler/platforms/aihot';
import { ArxivCrawler } from '../crawler/platforms/arxiv';
import { RssNewsCrawler } from '../crawler/platforms/rss_news';
import { WebReaderCrawler } from '../crawler/platforms/web_reader';
import { GitHubRepositoriesCrawler } from '../crawler/platforms/github_repositories';
import { getConnectorManifest } from './registry';

const executors: Record<string, () => { start(): Promise<void> }> = {
  xhs: () => new XiaoHongShuCrawler(),
  douyin: () => new DouyinCrawler(),
  kuaishou: () => new KuaishouCrawler(),
  bili: () => new BilibiliCrawler(),
  weibo: () => new WeiboCrawler(),
  tieba: () => new TiebaCrawler(),
  zhihu: () => new ZhihuCrawler(),
  baidu: () => new BaiduCrawler(),
  bing: () => new BingCrawler(),
  so360: () => new So360Crawler(),
  sogou: () => new SogouCrawler(),
  toutiao: () => new ToutiaoCrawler(),
  aihot: () => new AiHotCrawler(),
  arxiv: () => new ArxivCrawler(),
  github_repositories: () => new GitHubRepositoriesCrawler(),
  rss_news: () => new RssNewsCrawler(),
  media_parser: () => new MediaParserCrawler(),
  web_reader: () => new WebReaderCrawler(),
  zhaopin: () => new ZhaopinCrawler(),
  job51: () => new Job51Crawler(),
  liepin: () => new LiepinCrawler(),
  boss: () => new BossCrawler(),
  heimao: () => new HeimaoCrawler(),
  deepseek: () => new DeepSeekCrawler(),
  kimi: () => new KimiCrawler(),
  doubao: () => new DoubaoCrawler(),
  qwen: () => new QwenCrawler(),
  yuanbao: () => new YuanbaoCrawler(),
  nami: () => new NamiCrawler(),
  wenxin: () => new WenxinCrawler(),
};

export function createConnectorExecutor(id: string) {
  const factory = executors[id];
  if (!factory || !getConnectorManifest(id)) throw new Error(`Unsupported connector: ${id}`);
  return factory();
}
