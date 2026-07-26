import { activeConfig } from '../src/tools/config';
import { connectorOutput } from '../src/connectors/output/connector-output';
import { ToutiaoCrawler } from '../src/crawler/platforms/search_engine';

async function main() {
  const keyword = process.argv[2] || '小米汽车 口碑';
  const maxItems = Number(process.argv[3] || 25);

  activeConfig.KEYWORDS = keyword;
  activeConfig.CRAWLER_TYPE = 'search';
  activeConfig.CRAWLER_MAX_NOTES_COUNT = maxItems;
  activeConfig.START_PAGE = Number(process.argv[4] || 1);

  const captured: any[] = [];
  const original = connectorOutput.emitSearchEngineResult;
  (connectorOutput as any).emitSearchEngineResult = async (item: any) => {
    captured.push(item);
  };

  try {
    await new ToutiaoCrawler().start();
  } finally {
    (connectorOutput as any).emitSearchEngineResult = original;
  }

  console.log(`\n===== captured ${captured.length} / requested ${maxItems} =====`);
  for (const item of captured) {
    console.log(
      `#${String(item.search_rank).padStart(2)} [${item.publisher}|${item.publish_time || '-'}] ` +
      `${item.title.slice(0, 42)} | img=${item.images.length} | ${item.url.slice(0, 60)}`
    );
    if (!item.title || !item.url) console.error('   !! MISSING title/url');
  }

  const urls = captured.map((c) => c.url);
  console.log('\nunique urls:', new Set(urls).size, '/', urls.length);
  console.log('with snippet:', captured.filter((c) => c.snippet).length);
  console.log('with time:', captured.filter((c) => c.publish_time).length);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
