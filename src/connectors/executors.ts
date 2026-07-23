import { BilibiliCrawler } from '../crawler/platforms/bili';
import { DouyinCrawler } from '../crawler/platforms/douyin';
import { KuaishouCrawler } from '../crawler/platforms/ks';
import { TiebaCrawler } from '../crawler/platforms/tieba';
import { WeiboCrawler } from '../crawler/platforms/weibo';
import { XiaoHongShuCrawler } from '../crawler/platforms/xhs';
import { ZhihuCrawler } from '../crawler/platforms/zhihu';
import { BaiduCrawler, BingCrawler, So360Crawler, SogouCrawler } from '../crawler/platforms/search_engine';
import { MediaParserCrawler } from '../crawler/platforms/media_parser';
import { DeepSeekCrawler } from '../crawler/platforms/deepseek';
import { KimiCrawler } from '../crawler/platforms/kimi';
import { getConnectorManifest } from './registry';

const executors: Record<string, () => { start(): Promise<void> }> = {
  xhs: () => new XiaoHongShuCrawler(),
  dy: () => new DouyinCrawler(),
  ks: () => new KuaishouCrawler(),
  bili: () => new BilibiliCrawler(),
  wb: () => new WeiboCrawler(),
  tieba: () => new TiebaCrawler(),
  zhihu: () => new ZhihuCrawler(),
  baidu: () => new BaiduCrawler(),
  bing: () => new BingCrawler(),
  so360: () => new So360Crawler(),
  sogou: () => new SogouCrawler(),
  media_parser: () => new MediaParserCrawler(),
  deepseek: () => new DeepSeekCrawler(),
  kimi: () => new KimiCrawler(),
};

export function createConnectorExecutor(id: string) {
  const factory = executors[id];
  if (!factory || !getConnectorManifest(id)) throw new Error(`Unsupported connector: ${id}`);
  return factory();
}
