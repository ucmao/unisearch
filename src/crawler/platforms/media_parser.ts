import { AbstractCrawler } from '../base/BaseCrawler';
import { activeConfig } from '../../tools/config';
import { dbStore } from '../store';
import { systemHttpClient } from '../base/SystemHttpClient';

function extractUrls(input: string): string[] {
  if (!input) return [];
  return input
    .split(/[\n,\s]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export class MediaParserCrawler extends AbstractCrawler {
  public async start(): Promise<void> {
    const rawTargets = activeConfig.SPECIFIED_IDS || activeConfig.KEYWORDS || '';
    const targets = extractUrls(rawTargets);

    if (targets.length === 0) {
      console.warn('[MediaParser] No valid URLs or text inputs provided.');
      return;
    }

    console.log(`[MediaParser] Starting direct parse execution for ${targets.length} target(s) via parse.ucmao.cn...`);

    let index = 0;
    for (const text of targets) {
      index++;
      console.log(`[MediaParser] [${index}/${targets.length}] Direct parsing: "${text}"`);

      try {
        const timestamp = Math.floor(Date.now() / 1000);
        const res = await systemHttpClient.post(
          'https://parse.ucmao.cn/api/open/direct_parse',
          {
            token: 'klt-unisearch-198c79',
            timestamp,
            text,
          },
          {
            headers: { 'Content-Type': 'application/json' },
            timeout: 15000,
          }
        );

        const json = res.data;
        if (!json || json.succ !== true || !json.data) {
          console.error(`[MediaParser] Parsing failed for "${text}": ${json?.retdesc || json?.msg || 'Unknown error'}`);
          continue;
        }

        const data = json.data;
        const platformName = data.platform || '多平台';
        const title = data.title || '无标题作品';
        const videoUrl = data.video_url || '';
        const imagesCount = Array.isArray(data.images) ? data.images.length : 0;

        await dbStore.storeMediaParsedResult({
          ...data,
          source_keyword: text,
        });

        console.log(`[MediaParser] [${platformName}] Stored: "${title}" | Video: ${videoUrl ? 'Yes' : 'No'} | Images: ${imagesCount}`);
      } catch (err: any) {
        console.error(`[MediaParser] Network or runtime error parsing "${text}": ${err.message}`);
      }
    }

    console.log('[MediaParser] Direct parse execution completed.');
  }
}
