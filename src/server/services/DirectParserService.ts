import { systemHttpClient } from '../../crawler/base/SystemHttpClient';
import { buildRawItem } from '../../connectors/output/connector-output';
import { documentEngine } from '../../document/document-engine';

export interface ParseResult {
  succ: boolean;
  message?: string;
  data?: {
    platform?: string;
    title?: string;
    author?: {
      nickname?: string;
      author_id?: string;
    };
    author_name?: string;
    creator_name?: string;
    cover_url?: string;
    video_url?: string;
    images?: string[];
    audio_url?: string;
    music_url?: string;
    video_id?: string;
    live_photos?: Array<{ live_photo_url?: string }>;
    [key: string]: any;
  };
}

export class DirectParserService {
  public async parseSingleText(text: string): Promise<ParseResult> {
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
        return {
          succ: false,
          message: json?.retdesc || json?.msg || '未能解析出有效的高清媒体，可能链接已失效或平台接口调整。',
        };
      }

      const data = json.data;
      try {
        await documentEngine.ingest(buildRawItem('emitMediaParsedResult', {
          ...data,
          source_keyword: text,
        }));
      } catch (err: any) {
        console.warn('[DirectParserService] Failed to persist media parsed result to DB:', err.message);
      }

      return {
        succ: true,
        data,
      };
    } catch (error: any) {
      return {
        succ: false,
        message: error.message || '网络连接超时，无法请求解析服务。',
      };
    }
  }

  public formatMarkdownReply(text: string, result: ParseResult): string {
    if (!result.succ || !result.data) {
      return `解析失败：${result.message || '未能成功获取解析数据。'}\n\n如需抓取更多热门评论或深层数据，您可以随时要求我发起**平台采集任务**。`;
    }

    const d = result.data;
    const platform = d.platform || '全网';
    const title = d.title || '无标题作品';
    const nickname = d.author?.nickname || d.author_name || d.creator_name || '未知作者';
    const livePhotoVideo = Array.isArray(d.live_photos) && d.live_photos[0]?.live_photo_url
      ? d.live_photos[0].live_photo_url
      : '';
    const videoUrl = d.video_url || livePhotoVideo || '';
    const images: string[] = Array.isArray(d.images) ? d.images : [];
    const coverUrl = d.cover_url || (images.length ? images[0] : '');
    const audioUrl = d.audio_url || d.music_url || '';

    const lines: string[] = [];
    lines.push(`✅ **${platform}无水印解析成功**\n`);
    lines.push(`- **作品标题**：${title}`);
    lines.push(`- **作者**：${nickname}`);

    if (videoUrl) {
      lines.push(`- **无水印视频地址**：[点击下载/观看视频](${videoUrl})`);
    }

    if (audioUrl) {
      lines.push(`- **背景音乐/原声地址**：[点击下载音频](${audioUrl})`);
    }

    if (images.length > 0) {
      lines.push(`- **无水印原图 (${images.length} 张)**：`);
      images.slice(0, 8).forEach((imgUrl, idx) => {
        lines.push(`  ${idx + 1}. [查看高清大图 ${idx + 1}](${imgUrl})`);
      });
      if (images.length > 8) {
        lines.push(`  *(其余 ${images.length - 8} 张图片已自动存入数据大盘)*`);
      }
    }

    if (coverUrl && !images.length) {
      lines.push(`- **作品封面**：[查看高清封面](${coverUrl})`);
    }

    lines.push(`\n解析结果已自动保存至本地数据看板。如果需要采集该作者的其他作品或评论，可以随时告诉我！`);

    return lines.join('\n');
  }
}

export const directParserService = new DirectParserService();
