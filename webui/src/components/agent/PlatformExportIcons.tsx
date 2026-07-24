import React from 'react'
import { Loader2 } from 'lucide-react'

export interface PlatformConfig {
  id: string
  name: string
  tag: string
  description: string
  color: string
  hoverBg: string
  hoverBorder: string
  icon: string
}

export const PLATFORMS: PlatformConfig[] = [
  {
    id: 'obsidian',
    name: 'Obsidian',
    tag: 'Vault 双链笔记',
    description: '导出包含 Frontmatter 元数据、独立 Markdown 文件与 [[双链]] 索引的 Obsidian 知识库',
    color: '#A855F7',
    hoverBg: 'hover:bg-purple-500/15',
    hoverBorder: 'hover:border-purple-500/60',
    icon: '/logos/exporter_obsidian.png',
  },
  {
    id: 'ima',
    name: '腾讯 IMA',
    tag: 'IMA 知识包',
    description: '导出包含 sources/ Markdown 源码与 manifest.json 索引结构的 IMA 导入包',
    color: '#10B981',
    hoverBg: 'hover:bg-emerald-500/15',
    hoverBorder: 'hover:border-emerald-500/60',
    icon: '/logos/exporter_ima.png',
  },
  {
    id: 'notion',
    name: 'Notion',
    tag: '数据库文档包',
    description: '导出 Notion 风格 Markdown 笔记及带有完整属性字段的 database.csv',
    color: '#F43F5E',
    hoverBg: 'hover:bg-rose-500/15',
    hoverBorder: 'hover:border-rose-500/60',
    icon: '/logos/exporter_notion.png',
  },
  {
    id: 'logseq',
    name: 'Logseq',
    tag: '双链大纲包',
    description: '导出包含 Logseq 块级 Outliner 属性结构的 pages/ Markdown 大纲文件',
    color: '#06B6D4',
    hoverBg: 'hover:bg-cyan-500/15',
    hoverBorder: 'hover:border-cyan-500/60',
    icon: '/logos/exporter_logseq.png',
  },
  {
    id: 'dify',
    name: 'Dify / RAG',
    tag: 'AI 向量库',
    description: '导出符合 Dify / FastGPT 向量数据库标准的 chunks.jsonl 文本分块包',
    color: '#3B82F6',
    hoverBg: 'hover:bg-blue-500/15',
    hoverBorder: 'hover:border-blue-500/60',
    icon: '/logos/exporter_dify.png',
  },
  {
    id: 'yuque',
    name: '语雀',
    tag: '语雀文档包',
    description: '导出符合语雀目录树规范的 docs/ Markdown 与 toc.json 目录文件',
    color: '#22C55E',
    hoverBg: 'hover:bg-green-500/15',
    hoverBorder: 'hover:border-green-500/60',
    icon: '/logos/exporter_yuque.png',
  },
  {
    id: 'feishu',
    name: '飞书文档',
    tag: '飞书知识库',
    description: '导出符合飞书文档体系规范的 docs/ 结构包与 index.json 索引',
    color: '#0284C7',
    hoverBg: 'hover:bg-sky-500/15',
    hoverBorder: 'hover:border-sky-500/60',
    icon: '/logos/exporter_lark.png',
  },
  {
    id: 'markdown',
    name: 'Markdown',
    tag: '通用长文合集',
    description: '导出包含所有知识条目的通用单文件 Markdown 汇总全集文档',
    color: '#38BDF8',
    hoverBg: 'hover:bg-cyan-500/15',
    hoverBorder: 'hover:border-cyan-500/60',
    icon: '/logos/exporter_markdown.png',
  },
]

export interface PlatformExportIconsProps {
  onSelectPlatform: (platform: PlatformConfig) => void
  isPending?: boolean
  activeExporterId?: string | null
}

export const PlatformExportIcons: React.FC<PlatformExportIconsProps> = ({
  onSelectPlatform,
  isPending,
  activeExporterId,
}) => {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {PLATFORMS.map((platform) => {
        const isLoading = isPending && activeExporterId === platform.id
        return (
          <div key={platform.id} className="relative flex items-center justify-center shrink-0">
            <button
              type="button"
              onClick={() => onSelectPlatform(platform)}
              disabled={isPending}
              className={`relative flex h-8.5 w-8.5 shrink-0 items-center justify-center rounded-lg border border-cyber-border-subtle bg-cyber-card/70 transition-all duration-200 ${platform.hoverBg} ${platform.hoverBorder} hover:scale-110 hover:shadow-lg hover:shadow-cyan-500/10 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin text-cyber-neon-cyan" />
              ) : (
                <img
                  src={platform.icon}
                  alt={platform.name}
                  className="h-6 w-6 shrink-0 object-contain pointer-events-none transition-transform duration-200"
                />
              )}
            </button>
          </div>
        )
      })}
    </div>
  )
}
