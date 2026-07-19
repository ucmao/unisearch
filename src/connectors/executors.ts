import { BilibiliCrawler } from '../crawler/platforms/bili';
import { DouyinCrawler } from '../crawler/platforms/douyin';
import { KuaishouCrawler } from '../crawler/platforms/ks';
import { TiebaCrawler } from '../crawler/platforms/tieba';
import { WeiboCrawler } from '../crawler/platforms/weibo';
import { XiaoHongShuCrawler } from '../crawler/platforms/xhs';
import { ZhihuCrawler } from '../crawler/platforms/zhihu';
import { getConnectorManifest } from './registry';

const executors: Record<string, () => { start(): Promise<void> }> = {
  xhs: () => new XiaoHongShuCrawler(),
  dy: () => new DouyinCrawler(),
  ks: () => new KuaishouCrawler(),
  bili: () => new BilibiliCrawler(),
  wb: () => new WeiboCrawler(),
  tieba: () => new TiebaCrawler(),
  zhihu: () => new ZhihuCrawler(),
};

export function createConnectorExecutor(id: string) {
  const factory = executors[id];
  if (!factory || !getConnectorManifest(id)) throw new Error(`Unsupported connector: ${id}`);
  return factory();
}
