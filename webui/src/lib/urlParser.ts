export interface ParsedId {
  id: string
  type: 'video' | 'creator' | 'unknown'
  original: string
  isValid: boolean
}

const platformDomains: Record<string, string[]> = {
  xhs: ['xiaohongshu.com', 'xhslink.com'],
  douyin: ['douyin.com', 'iesdouyin.com'],
  kuaishou: ['kuaishou.com'],
  bili: ['bilibili.com', 'b23.tv'],
  weibo: ['weibo.com', 'weibo.cn'],
  tieba: ['tieba.baidu.com'],
  zhihu: ['zhihu.com'],
  zhaopin: ['zhaopin.com'],
}

export function detectPlatform(input: string): string | null {
  const normalized = input.toLowerCase()
  const matches = Object.entries(platformDomains)
    .filter(([, domains]) => domains.some((domain) => normalized.includes(domain)))
    .map(([platform]) => platform)

  return matches.length === 1 ? matches[0] : null
}

// URL patterns for different platforms
const platformPatterns: Record<string, {
  video: RegExp[]
  creator: RegExp[]
}> = {
  zhaopin: {
    video: [
      /zhaopin\.com\/jobdetail\/([a-zA-Z0-9]+)/,
    ],
    creator: [
      /zhaopin\.com\/company\/([a-zA-Z0-9]+)/,
    ],
  },
  xhs: {
    video: [
      /xiaohongshu\.com\/explore\/([a-zA-Z0-9]+)/,
      /xiaohongshu\.com\/discovery\/item\/([a-zA-Z0-9]+)/,
      /xhslink\.com\/([a-zA-Z0-9]+)/,
    ],
    creator: [
      /xiaohongshu\.com\/user\/profile\/([a-zA-Z0-9]+)/,
    ],
  },
  douyin: {
    video: [
      /douyin\.com\/video\/(\d+)/,
      /v\.douyin\.com\/([a-zA-Z0-9]+)/,
      /iesdouyin\.com\/share\/video\/(\d+)/,
    ],
    creator: [
      /douyin\.com\/user\/([a-zA-Z0-9_-]+)/,
    ],
  },
  bili: {
    video: [
      /bilibili\.com\/video\/(BV[a-zA-Z0-9]+)/,
      /bilibili\.com\/video\/(av\d+)/,
      /b23\.tv\/([a-zA-Z0-9]+)/,
    ],
    creator: [
      /space\.bilibili\.com\/(\d+)/,
    ],
  },
  weibo: {
    video: [
      /weibo\.com\/\d+\/([a-zA-Z0-9]+)/,
      /m\.weibo\.cn\/status\/(\d+)/,
    ],
    creator: [
      /weibo\.com\/u\/(\d+)/,
      /weibo\.com\/([a-zA-Z0-9]+)$/,
    ],
  },
  kuaishou: {
    video: [
      /kuaishou\.com\/short-video\/([a-zA-Z0-9_-]+)/,
      /v\.kuaishou\.com\/([a-zA-Z0-9]+)/,
    ],
    creator: [
      /kuaishou\.com\/profile\/([a-zA-Z0-9_-]+)/,
    ],
  },
}

export function parseUrl(input: string, platform: string): ParsedId {
  const trimmed = input.trim()

  // If it's just an ID (no URL structure), return as unknown type
  if (!trimmed.includes('/') && !trimmed.includes('.')) {
    return {
      id: trimmed,
      type: 'unknown',
      original: trimmed,
      isValid: trimmed.length > 0,
    }
  }

  const patterns = platformPatterns[platform]
  if (!patterns) {
    return {
      id: trimmed,
      type: 'unknown',
      original: trimmed,
      isValid: false,
    }
  }

  // Try video patterns
  for (const pattern of patterns.video) {
    const match = trimmed.match(pattern)
    if (match && match[1]) {
      return {
        id: match[1],
        type: 'video',
        original: trimmed,
        isValid: true,
      }
    }
  }

  // Try creator patterns
  for (const pattern of patterns.creator) {
    const match = trimmed.match(pattern)
    if (match && match[1]) {
      return {
        id: match[1],
        type: 'creator',
        original: trimmed,
        isValid: true,
      }
    }
  }

  // Fallback: try to extract any ID-like segment
  const urlMatch = trimmed.match(/([a-zA-Z0-9_-]{6,})/)
  if (urlMatch) {
    return {
      id: urlMatch[1],
      type: 'unknown',
      original: trimmed,
      isValid: false,
    }
  }

  return {
    id: trimmed,
    type: 'unknown',
    original: trimmed,
    isValid: false,
  }
}

export function parseMultipleUrls(input: string, platform: string): ParsedId[] {
  if (!input.trim()) return []

  const items = input
    .split(/[,\n]+/)
    .map(s => s.trim())
    .filter(Boolean)

  return items.map(item => parseUrl(item, platform))
}
