import { BilibiliCrawler } from '../crawler/platforms/bili';
import { DouyinCrawler } from '../crawler/platforms/douyin';
import { KuaishouCrawler } from '../crawler/platforms/kuaishou';
import { TiebaCrawler } from '../crawler/platforms/tieba';
import { WeiboCrawler } from '../crawler/platforms/weibo';
import { XiaoHongShuCrawler } from '../crawler/platforms/xhs';
import { ZhihuCrawler } from '../crawler/platforms/zhihu';
import { BaiduCrawler, BingCrawler, So360Crawler, SogouCrawler } from '../crawler/platforms/search_engine';
import { MediaParserCrawler } from '../crawler/platforms/media_parser';
import { ZhaopinCrawler } from '../crawler/platforms/zhaopin';
import { HeimaoCrawler } from '../crawler/platforms/heimao';
import { DeepSeekCrawler } from '../crawler/platforms/deepseek';
import { KimiCrawler } from '../crawler/platforms/kimi';
import { DoubaoCrawler } from '../crawler/platforms/doubao';
import { QwenCrawler } from '../crawler/platforms/qwen';
import { NamiCrawler, WenxinCrawler, YuanbaoCrawler } from '../crawler/platforms/china_ai_web_qa';
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
  media_parser: () => new MediaParserCrawler(),
  zhaopin: () => new ZhaopinCrawler(),
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
