import * as cheerio from 'cheerio';
import { AbstractCrawler } from '../base/BaseCrawler';
import { activeConfig } from '../../tools/config';
import { connectorOutput } from '../../connectors/output/connector-output';
import { systemHttpClient } from '../base/SystemHttpClient';

function extractUrls(input: string): string[] {
  if (!input) return [];
  const urlRegex = /https?:\/\/[^\s,，;；"'\(\)\<\>\[\]]+/g;
  const matches = input.match(urlRegex) || [];
  return [...new Set(matches.map((url) => url.trim()))];
}

function cleanText(str: string): string {
  if (!str) return '';
  return str
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveUrl(relativeUrl: string, baseUrl: string): string {
  if (!relativeUrl) return '';
  try {
    return new URL(relativeUrl, baseUrl).toString();
  } catch {
    return relativeUrl;
  }
}

export interface WebReaderParsedArticle {
  content_id: string;
  title: string;
  summary: string;
  description: string;
  content_url: string;
  creator_name: string;
  site_name: string;
  published_at?: string | number;
  images: string[];
  source_keyword?: string;
}

export class WebReaderCrawler extends AbstractCrawler {
  public async start(): Promise<void> {
    await this.search();
  }

  public async search(): Promise<void> {
    const rawInputs = activeConfig.SPECIFIED_IDS || activeConfig.KEYWORDS || activeConfig.TARGET_URLS || '';
    const urls = extractUrls(rawInputs);

    if (urls.length === 0) {
      console.warn('[WebReader] No valid HTTP/HTTPS URLs found in input.');
      return;
    }

    console.log(`[WebReader] Starting content extraction for ${urls.length} target URL(s)...`);

    let index = 0;
    for (const url of urls) {
      index++;
      console.log(`[WebReader] [${index}/${urls.length}] Fetching & parsing: ${url}`);

      try {
        const article = await this.parseWebPage(url);
        if (article) {
          await connectorOutput.emitWebReaderResult({
            ...article,
            source_keyword: url,
          });
          console.log(`[WebReader] Successfully extracted: "${article.title}" (${article.description.length} chars)`);
        }
      } catch (err: any) {
        console.error(`[WebReader] Failed to process URL "${url}": ${err.message}`);
      }
    }

    console.log('[WebReader] Content extraction completed.');
  }

  public async parseWebPage(url: string): Promise<WebReaderParsedArticle | null> {
    let html = '';
    try {
      const res = await systemHttpClient.get(url, {
        mode: 'desktop',
        timeout: 15000,
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
        },
      });
      html = typeof res.data === 'string' ? res.data : String(res.data || '');
    } catch (err: any) {
      console.error(`[WebReader] HTTP fetch failed for ${url}: ${err.message}`);
      return null;
    }

    if (!html.trim()) {
      console.warn(`[WebReader] Empty HTML response from ${url}`);
      return null;
    }

    const $ = cheerio.load(html);

    // 1. Remove non-content / boilerplate DOM nodes
    $('script, style, noscript, iframe, svg, header, footer, nav, form, aside, button, input, .ad, .ads, .advertisement, #comments, .comments, .header, .footer, .sidebar, .menu, .nav').remove();

    // 2. Extract Title
    let title = $('meta[property="og:title"]').attr('content') ||
                $('meta[name="twitter:title"]').attr('content') ||
                $('meta[name="title"]').attr('content') ||
                $('h1').first().text() ||
                $('title').text() ||
                '';
    title = cleanText(title);

    // 3. Extract Publisher / Site Name / Author
    const siteName = $('meta[property="og:site_name"]').attr('content') ||
                     $('meta[name="application-name"]').attr('content') ||
                     '';
    let author = $('meta[name="author"]').attr('content') ||
                 $('meta[name="publisher"]').attr('content') ||
                 $('meta[property="article:author"]').attr('content') ||
                 siteName ||
                 '';
    if (!author) {
      try {
        const parsedUrl = new URL(url);
        author = parsedUrl.hostname.replace(/^www\./, '');
      } catch {
        author = 'Web';
      }
    }
    author = cleanText(author);

    // 4. Extract Publish Time
    const pubTimeStr = $('meta[property="article:published_time"]').attr('content') ||
                       $('meta[name="pubdate"]').attr('content') ||
                       $('meta[name="publishdate"]').attr('content') ||
                       $('meta[name="publication_date"]').attr('content') ||
                       $('time').attr('datetime') ||
                       $('time').first().text() ||
                       '';
    let publishedAt: string | number | undefined = cleanText(pubTimeStr);
    if (!publishedAt) {
      const pageText = $.text();
      const dateMatch = /(\d{4}[-/年]\d{1,2}[-/月]\d{1,2}(?:\s+\d{1,2}:\d{1,2}(?:\:\d{1,2})?)?)/.exec(pageText);
      if (dateMatch) {
        publishedAt = dateMatch[1];
      }
    }

    // 5. Extract Summary / Description
    let metaDesc = $('meta[property="og:description"]').attr('content') ||
                    $('meta[name="description"]').attr('content') ||
                    $('meta[name="twitter:description"]').attr('content') ||
                    '';
    metaDesc = cleanText(metaDesc);

    // 6. Extract Main Content Body
    // Candidate main content containers
    const candidates = [
      'article',
      'main',
      '[role="main"]',
      '.post-content',
      '.article-content',
      '.entry-content',
      '.content',
      '.main-content',
      '#article-content',
      '#content',
      '.art_content',
      '.txt_content',
      '.detail-content',
      '.body-content',
    ];

    let $container: cheerio.Cheerio<cheerio.Element> | null = null;
    for (const selector of candidates) {
      const found = $(selector);
      if (found.length > 0) {
        $container = found.first();
        break;
      }
    }

    if (!$container) {
      $container = $('body');
    }

    // Extract text paragraphs from container
    const paragraphs: string[] = [];
    $container.find('p, h2, h3, h4, h5, section, blockquote, li').each((_, el) => {
      const text = cleanText($(el).text());
      if (text.length > 15 && !paragraphs.includes(text)) {
        paragraphs.push(text);
      }
    });

    let description = paragraphs.join('\n\n');
    if (!description || description.length < 50) {
      description = cleanText($container.text());
    }

    const summary = metaDesc || description.slice(0, 300);

    // 7. Extract Images
    const images: string[] = [];
    const ogImage = $('meta[property="og:image"]').attr('content');
    if (ogImage) {
      const resolved = resolveUrl(ogImage, url);
      if (resolved) images.push(resolved);
    }

    $container.find('img').each((_, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src');
      if (src) {
        const resolved = resolveUrl(src, url);
        if (resolved && /^https?:\/\//.test(resolved) && !images.includes(resolved)) {
          images.push(resolved);
        }
      }
    });

    return {
      content_id: url,
      title: title || '未知标题网页',
      summary: summary || title,
      description: description || summary || title,
      content_url: url,
      creator_name: author,
      site_name: cleanText(siteName),
      published_at: publishedAt,
      images: images.slice(0, 10),
    };
  }
}
