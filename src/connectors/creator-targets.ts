export interface CreatorTargetGuidance {
  platform: 'xhs' | 'douyin' | 'kuaishou' | 'bili' | 'weibo' | 'tieba' | 'zhihu';
  label: string;
  accepted: string[];
  preferred: string;
  examples: string[];
  notes: string[];
}

/**
 * 创作者主页采集的唯一输入契约。Manifest、Skill 和 AI 规划上下文都应引用
 * 这里，避免平台实现已经变化、界面说明却仍停留在旧格式。
 */
export const CREATOR_TARGET_GUIDANCE: CreatorTargetGuidance[] = [
  {
    platform: 'xhs',
    label: '小红书',
    accepted: ['创作者主页完整链接', '主页分享短链', 'user_id'],
    preferred: '带 xsec_token 的创作者主页完整链接',
    examples: ['https://www.xiaohongshu.com/user/profile/{user_id}?xsec_token=...', '{user_id}'],
    notes: ['裸 ID 必须同时指定平台为小红书；部分账号访问需要主页链接中的 xsec_token。'],
  },
  {
    platform: 'douyin',
    label: '抖音',
    accepted: ['创作者主页完整链接', 'v.douyin.com 主页分享短链', 'sec_uid'],
    preferred: 'https://www.douyin.com/user/{sec_uid} 主页链接',
    examples: ['https://www.douyin.com/user/{sec_uid}', '{sec_uid}'],
    notes: ['需要 sec_uid，不是作品 aweme_id，也不建议使用短数字 uid。'],
  },
  {
    platform: 'kuaishou',
    label: '快手',
    accepted: ['创作者主页完整链接', 'v.kuaishou.com 主页分享短链', 'userId'],
    preferred: 'https://www.kuaishou.com/profile/{userId} 主页链接',
    examples: ['https://www.kuaishou.com/profile/{userId}', '{userId}'],
    notes: ['需要主页 userId，不是作品 photoId。'],
  },
  {
    platform: 'bili',
    label: '哔哩哔哩',
    accepted: ['UP 主空间链接', '数字 mid'],
    preferred: 'https://space.bilibili.com/{mid} 空间链接',
    examples: ['https://space.bilibili.com/123456', '123456'],
    notes: ['mid 必须是纯数字；作品 BV/AV 号不能作为主页目标。'],
  },
  {
    platform: 'weibo',
    label: '微博',
    accepted: ['包含数字 UID 的用户主页链接', '数字 UID', '可跳转到用户主页的分享短链'],
    preferred: 'https://weibo.com/u/{uid} 或 https://m.weibo.cn/u/{uid}',
    examples: ['https://weibo.com/u/123456', '123456'],
    notes: ['需要数字 UID；个性域名、昵称和博文 mid 不能替代 UID。'],
  },
  {
    platform: 'tieba',
    label: '百度贴吧',
    accepted: ['贴吧名称', '贴吧首页链接', '用户主页完整链接'],
    preferred: '贴吧使用 https://tieba.baidu.com/f?kw={吧名}；用户使用其 home/main 主页链接',
    examples: ['codex吧', 'https://tieba.baidu.com/f?kw=codex', 'https://tieba.baidu.com/home/main?...'],
    notes: ['贴吧的“主体”可以是吧或用户；采集用户时优先提供完整主页链接，不要只填昵称。'],
  },
  {
    platform: 'zhihu',
    label: '知乎',
    accepted: ['作者主页完整链接', '可跳转到作者主页的分享链接', 'url_token'],
    preferred: 'https://www.zhihu.com/people/{url_token} 主页链接',
    examples: ['https://www.zhihu.com/people/{url_token}', '{url_token}'],
    notes: ['需要 people 路径中的 url_token，不是回答、问题或文章 ID。'],
  },
];

export function creatorTargetDescription(platform: string): string {
  const guidance = CREATOR_TARGET_GUIDANCE.find((item) => item.platform === platform);
  if (!guidance) return '支持主体 ID 或主页链接，多个目标使用逗号或换行分隔。';
  return `接受：${guidance.accepted.join('、')}。推荐：${guidance.preferred}。${guidance.notes.join('')}`;
}
