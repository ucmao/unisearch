import { AbstractCrawler } from '../base/BaseCrawler';
import { activeConfig } from '../../tools/config';
import { connectorOutput } from '../../connectors/output/connector-output';
import { systemHttpClient } from '../base/SystemHttpClient';

export function extractParserTargets(input: string): string[] {
  if (!input) return [];
  const urls = input.match(/https?:\/\/[^\s,，;；"'\(\)\<\>\[\]{}]+/g) || [];
  if (urls.length) {
    return [...new Set(urls
      .map((url) => url.trim().replace(/[.，;；!！?？。)\]\\]+$/, ''))
      .filter((url) => /^https?:\/\/\w+/i.test(url)))];
  }
  return [...new Set(input
    .split(/[\n,，]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0))];
}

const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export class MediaParserCrawler extends AbstractCrawler {
  public async start(): Promise<void> {
    await this.search();
  }

  /**
   * This connector only resolves the URLs it is handed, so there is no keyword
   * mode to branch into — `search` is simply the one pass it performs.
   */
  public async search(): Promise<void> {
    const rawTargets = activeConfig.SPECIFIED_IDS || activeConfig.KEYWORDS || '';
    const targets = extractParserTargets(rawTargets);

    if (targets.length === 0) {
      console.warn('[MediaParser] No valid URLs or text inputs provided.');
      return;
    }

    console.log(`[MediaParser] Starting direct parse execution for ${targets.length} target(s) via parse.ucmao.cn...`);

    let index = 0;
    for (const text of targets) {
      // The parser API is deliberately serialized and rate-limited. Apart from
      // being friendlier to the service, this makes long multi-link batches
      // predictable and prevents accidental request bursts.
      if (index > 0) await wait(1000);
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

        await connectorOutput.emitMediaParsedResult({
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
